
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
       * 优化移动端摄像头约束：
       * 1. 显式请求 9:16 宽高比，减少浏览器自动裁剪。
       * 2. 使用 720x1280 (HD) 作为理想值，这在大多数手机前置摄像头上比 1080p 兼容性更好，
       *    且不容易触发导致画面“变近”的数字缩放。
       */
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: 'user',
          aspectRatio: { ideal: 9 / 16 },
          width: { ideal: 720 },
          height: { ideal: 1280 }
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
      setError("无法访问摄像头或麦克风，请检查权限设置");
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

  // --- SCREENSHOT LOGIC ---
  const takeScreenshot = async () => {
    if (!videoRef.current) return;
    
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;

    // Draw video (mirrored)
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(videoRef.current, -canvas.width, 0, canvas.width, canvas.height);
    ctx.restore();

    // Draw HUD Data Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.beginPath();
    ctx.roundRect(30, canvas.height - 300, 320, 260, 20);
    ctx.fill();
    
    // Draw HUD Data Text
    ctx.fillStyle = 'white';
    ctx.font = 'bold 32px sans-serif';
    ctx.fillText(`YAW: ${Math.abs(pose.yaw)}°`, 60, canvas.height - 240);
    ctx.fillText(`PIT: ${Math.abs(pose.pitch)}°`, 60, canvas.height - 200);
    ctx.fillText(`ROL: ${Math.abs(pose.roll)}°`, 60, canvas.height - 160);
    ctx.fillText(`VOL: ${pose.volume}dB`, 60, canvas.height - 120);
    ctx.fillText(`DST: ${pose.distance}cm`, 60, canvas.height - 80);

    const link = document.createElement('a');
    link.download = `head-pose-${Date.now()}.png`;
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
        setError("初始化失败，请刷新页面");
      }
    };
    init();
    return () => stopCapture();
  }, [setupSensors, startMonitoring]);

  const DataItem = ({ label, value, color, unit = "°" }: { label: string, value: number, color: string, unit?: string }) => (
    <div className="flex items-center gap-1.5 leading-none">
      <span className="text-[9px] font-bold text-white/50 uppercase tracking-tighter w-8">{label}</span>
      <span className={`text-[14px] font-mono font-bold ${color}`}>
        {value}<span className="text-[9px] ml-0.5 opacity-30 font-sans font-normal">{unit}</span>
      </span>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-neutral-950 flex items-center justify-center overflow-hidden select-none">
      <div className="relative h-full aspect-[9/16] max-h-screen w-auto bg-black shadow-2xl flex flex-col overflow-hidden">
        
        {/* 
          video 使用 object-cover 填满 9:16 容器。
          如果获取到的流本身就是 9:16，则不会产生额外的放大感。
        */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
          style={{ transform: 'scaleX(-1)' }}
        />

        {/* Action Controls (Top Right) */}
        <div className="absolute top-4 right-4 pointer-events-none z-10">
          <button 
            onClick={takeScreenshot}
            className="pointer-events-auto w-12 h-12 rounded-2xl bg-black/30 backdrop-blur-xl border border-white/10 flex items-center justify-center text-white active:scale-90 transition-all shadow-xl"
            title="Take Screenshot"
          >
            <i className="fa-solid fa-camera text-lg"></i>
          </button>
        </div>

        {/* HUD Overlay - Bottom-Left Positioned & Ultra Compact */}
        {!isLoading && !error && (
          <div className="absolute left-4 bottom-6 pointer-events-none flex flex-col gap-3 z-10">
            <div className="flex flex-col gap-2 backdrop-blur-2xl bg-black/40 p-3.5 rounded-2xl border border-white/10 shadow-2xl">
              <DataItem label="Yaw" value={Math.abs(pose.yaw)} color="text-emerald-400" />
              <DataItem label="Pit" value={Math.abs(pose.pitch)} color="text-sky-400" />
              <DataItem label="Rol" value={Math.abs(pose.roll)} color="text-violet-400" />
              <div className="h-px w-full bg-white/10 my-0.5"></div>
              <DataItem label="Dst" value={pose.distance} color="text-amber-400" unit="cm" />
              <DataItem label="Vol" value={pose.volume || 0} color="text-pink-400" unit="dB" />
            </div>

            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-black/40 backdrop-blur-md rounded-full border border-white/5 w-fit">
              <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${pose.volume && pose.volume > 45 ? 'bg-pink-500' : 'bg-emerald-500'}`}></div>
              <span className="text-[8px] font-black text-white/40 uppercase tracking-widest">Live Tracking</span>
            </div>
          </div>
        )}

        {/* Loader/Error Displays */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
          {isLoading && (
            <div className="flex flex-col items-center gap-3">
              <div className="w-6 h-6 border-2 border-white/10 border-t-white rounded-full animate-spin"></div>
              <span className="text-white/40 text-[9px] font-black uppercase tracking-[0.4em]">Optimizing Feed</span>
            </div>
          )}
          {error && (
            <div className="bg-black/90 backdrop-blur-3xl px-6 py-5 rounded-2xl border border-red-500/30 mx-6 text-center shadow-2xl">
              <p className="text-red-400 text-[10px] font-bold uppercase tracking-widest mb-4">{error}</p>
              <button 
                onClick={() => window.location.reload()}
                className="px-6 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-[10px] font-black uppercase rounded-xl border border-red-500/30 pointer-events-auto transition-all"
              >
                重试
              </button>
            </div>
          )}
        </div>

        {/* Subtle Ambient Overlay */}
        <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-black/30 via-transparent to-black/10"></div>
      </div>
    </div>
  );
};

export default App;
