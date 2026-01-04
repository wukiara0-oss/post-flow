
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { PoseDetectionService } from './services/poseDetection';
import { HeadPose } from './types';

const App: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  
  const smoothedVolumeRef = useRef<number>(0);
  
  const [pose, setPose] = useState<HeadPose>({ pitch: 0, yaw: 0, roll: 0, distance: 0, volume: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const poseService = useRef(new PoseDetectionService());

  const stopCapture = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
  };

  const setupSensors = useCallback(async () => {
    setIsLoading(true);
    try {
      /**
       * 针对 iPhone 优化：
       * 取消强制的 width/height 和 aspectRatio。
       * 强制请求这些参数在 iOS 上常导致浏览器为了匹配比例而进行数字裁剪（Zoom-in）。
       * 仅使用 facingMode 让系统返回最宽广的原生预览流。
       */
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: 'user'
        },
        audio: true
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play();
          setIsLoading(false);
        };
      }

      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = audioCtx.createAnalyser();
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);
      analyser.fftSize = 256;
      
      audioContextRef.current = audioCtx;
      analyserRef.current = analyser;

    } catch (err) {
      console.error("Sensor setup failed:", err);
      setError("无法开启摄像头。请确保已授予摄像头和麦克风权限。");
      setIsLoading(false);
    }
  }, []);

  const startMonitoring = useCallback(() => {
    const dataArray = new Uint8Array(analyserRef.current?.frequencyBinCount || 0);

    const updateFrame = () => {
      let currentDisplayVolume = 0;

      let currentPoseResult: Partial<HeadPose> | null = null;
      if (videoRef.current && videoRef.current.readyState >= 2) {
        currentPoseResult = poseService.current.detect(videoRef.current, performance.now());
      }

      if (analyserRef.current) {
        analyserRef.current.getByteTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const amplitude = (dataArray[i] - 128) / 128;
          sum += amplitude * amplitude;
        }
        const rms = Math.sqrt(sum / dataArray.length);
        const db = rms > 0 ? 20 * Math.log10(rms) : -100;
        const rawVolume = Math.max(0, db + 95); 
        const alpha = 0.15;
        smoothedVolumeRef.current = (alpha * rawVolume) + ((1 - alpha) * smoothedVolumeRef.current);
        currentDisplayVolume = Math.round(smoothedVolumeRef.current);
      }

      if (currentPoseResult) {
        setPose({
          ...currentPoseResult as HeadPose,
          volume: currentDisplayVolume
        });
      } else {
        setPose(prev => ({ ...prev, volume: currentDisplayVolume }));
      }

      requestAnimationFrame(updateFrame);
    };
    updateFrame();
  }, []);

  const takeScreenshot = async () => {
    if (!videoRef.current) return;
    
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;

    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(videoRef.current, -canvas.width, 0, canvas.width, canvas.height);
    ctx.restore();

    // Responsive UI drawing for screenshot based on actual stream size
    const uiScale = canvas.width / 400; 
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.beginPath();
    ctx.roundRect(20 * uiScale, canvas.height - (180 * uiScale), 140 * uiScale, 160 * uiScale, 15 * uiScale);
    ctx.fill();
    
    ctx.fillStyle = 'white';
    ctx.font = `bold ${14 * uiScale}px sans-serif`;
    const startY = canvas.height - (150 * uiScale);
    const stepY = 25 * uiScale;
    ctx.fillText(`YAW: ${Math.abs(pose.yaw)}°`, 30 * uiScale, startY);
    ctx.fillText(`PIT: ${Math.abs(pose.pitch)}°`, 30 * uiScale, startY + stepY);
    ctx.fillText(`ROL: ${Math.abs(pose.roll)}°`, 30 * uiScale, startY + stepY * 2);
    ctx.fillText(`VOL: ${pose.volume}dB`, 30 * uiScale, startY + stepY * 3);
    ctx.fillText(`DST: ${pose.distance}cm`, 30 * uiScale, startY + stepY * 4);

    const link = document.createElement('a');
    link.download = `pose-analysis-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  useEffect(() => {
    const init = async () => {
      try {
        await poseService.current.init();
        await setupSensors();
        startMonitoring();
      } catch (err) {
        console.error("Init failed:", err);
        setError("系统初始化失败");
      }
    };
    init();
    return () => stopCapture();
  }, [setupSensors, startMonitoring]);

  const DataItem = ({ label, value, color, unit = "°" }: { label: string, value: number, color: string, unit?: string }) => (
    <div className="flex items-center gap-1.5 leading-none">
      <span className="text-[8px] font-bold text-white/40 uppercase tracking-tighter w-7">{label}</span>
      <span className={`text-[12px] font-mono font-bold ${color}`}>
        {value}<span className="text-[8px] ml-0.5 opacity-30 font-sans font-normal">{unit}</span>
      </span>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black flex items-center justify-center overflow-hidden select-none">
      {/* Container is now full-screen to adapt to any phone aspect ratio */}
      <div className="relative w-full h-full bg-black flex flex-col overflow-hidden">
        
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
          style={{ transform: 'scaleX(-1)' }}
        />

        {/* Action Controls */}
        <div className="absolute top-safe-area-inset-top mt-4 right-4 z-20">
          <button 
            onClick={takeScreenshot}
            className="w-10 h-10 rounded-full bg-black/20 backdrop-blur-xl border border-white/10 flex items-center justify-center text-white active:scale-90 transition-all shadow-xl"
          >
            <i className="fa-solid fa-camera text-sm"></i>
          </button>
        </div>

        {/* Minimalist HUD - Strict Bottom Left */}
        {!isLoading && !error && (
          <div className="absolute left-4 bottom-safe-area-inset-bottom mb-8 pointer-events-none flex flex-col gap-2 z-20">
            <div className="flex flex-col gap-1.5 backdrop-blur-3xl bg-black/30 p-3 rounded-2xl border border-white/5 shadow-2xl">
              <DataItem label="Yaw" value={Math.abs(pose.yaw)} color="text-emerald-400" />
              <DataItem label="Pit" value={Math.abs(pose.pitch)} color="text-sky-400" />
              <DataItem label="Rol" value={Math.abs(pose.roll)} color="text-violet-400" />
              <div className="h-px w-full bg-white/5 my-0.5"></div>
              <DataItem label="Dst" value={pose.distance} color="text-amber-400" unit="cm" />
              <DataItem label="Vol" value={pose.volume || 0} color="text-pink-400" unit="dB" />
            </div>

            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-black/20 backdrop-blur-md rounded-full border border-white/5 w-fit">
              <div className={`w-1 h-1 rounded-full animate-pulse ${pose.volume && pose.volume > 50 ? 'bg-pink-500' : 'bg-emerald-500'}`}></div>
              <span className="text-[7px] font-black text-white/30 uppercase tracking-[0.2em]">Live</span>
            </div>
          </div>
        )}

        {/* Loading Overlay */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black z-30">
            <div className="flex flex-col items-center gap-4">
              <div className="w-5 h-5 border-2 border-white/10 border-t-white rounded-full animate-spin"></div>
              <span className="text-white/20 text-[8px] font-black uppercase tracking-[0.5em]">Syncing Sensors</span>
            </div>
          </div>
        )}

        {/* Error Modal */}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-xl z-40 px-8 text-center">
            <div className="max-w-xs">
              <p className="text-red-400 text-xs font-bold uppercase tracking-widest mb-6 leading-relaxed">{error}</p>
              <button 
                onClick={() => window.location.reload()}
                className="w-full py-3 bg-white/5 hover:bg-white/10 text-white text-[10px] font-black uppercase rounded-2xl border border-white/10 transition-all"
              >
                刷新重试
              </button>
            </div>
          </div>
        )}

        {/* Vignette for depth */}
        <div className="absolute inset-0 pointer-events-none bg-radial-gradient from-transparent via-transparent to-black/40"></div>
      </div>
    </div>
  );
};

export default App;
