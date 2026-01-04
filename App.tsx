
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
  const [isCapturing, setIsCapturing] = useState(false);
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
    if (!videoRef.current || isCapturing) return;
    
    setIsCapturing(true);
    try {
      const video = videoRef.current;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Match screen/display dimensions
      const width = video.clientWidth;
      const height = video.clientHeight;
      canvas.width = width;
      canvas.height = height;

      // Calculate crop to mimic 'object-cover'
      const videoRatio = video.videoWidth / video.videoHeight;
      const canvasRatio = width / height;
      let sx, sy, sWidth, sHeight;

      if (videoRatio > canvasRatio) {
        sHeight = video.videoHeight;
        sWidth = video.videoHeight * canvasRatio;
        sx = (video.videoWidth - sWidth) / 2;
        sy = 0;
      } else {
        sWidth = video.videoWidth;
        sHeight = video.videoWidth / canvasRatio;
        sx = 0;
        sy = (video.videoHeight - sHeight) / 2;
      }

      // Draw mirrored video with cover crop
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(video, sx, sy, sWidth, sHeight, -width, 0, width, height);
      ctx.restore();

      // HUD Scaling and Drawing
      const uiScale = width / 400; 
      const hudX = 16 * uiScale;
      const hudY = 16 * uiScale;
      const hudW = 120 * uiScale;
      const hudH = 160 * uiScale;

      // Background Panel
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.beginPath();
      ctx.roundRect(hudX, hudY, hudW, hudH, 15 * uiScale);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = 1 * uiScale;
      ctx.stroke();

      // Drawing Helpers
      const drawDataItem = (label: string, value: string, color: string, y: number) => {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.font = `bold ${9 * uiScale}px Inter, sans-serif`;
        ctx.fillText(label.toUpperCase(), hudX + 16 * uiScale, y);
        
        ctx.fillStyle = color;
        ctx.font = `bold ${15 * uiScale}px monospace`;
        ctx.fillText(value, hudX + 45 * uiScale, y);
      };

      const startY = hudY + 35 * uiScale;
      const stepY = 26 * uiScale;

      drawDataItem('Yaw', `${Math.abs(pose.yaw)}°`, '#34d399', startY);
      drawDataItem('Pit', `${Math.abs(pose.pitch)}°`, '#38bdf8', startY + stepY);
      drawDataItem('Rol', `${Math.abs(pose.roll)}°`, '#a78bfa', startY + stepY * 2);
      
      // Separator
      ctx.beginPath();
      ctx.moveTo(hudX + 16 * uiScale, startY + stepY * 2.4);
      ctx.lineTo(hudX + hudW - 16 * uiScale, startY + stepY * 2.4);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.stroke();

      drawDataItem('Dst', `${pose.distance}cm`, '#fbbf24', startY + stepY * 3.1);
      drawDataItem('Vol', `${pose.volume}dB`, '#f472b6', startY + stepY * 4.1);

      // Status Indicator
      const statusY = hudY + hudH + 15 * uiScale;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.beginPath();
      ctx.roundRect(hudX, statusY, 70 * uiScale, 20 * uiScale, 10 * uiScale);
      ctx.fill();
      
      ctx.fillStyle = '#10b981'; // emerald-500
      ctx.beginPath();
      ctx.arc(hudX + 12 * uiScale, statusY + 10 * uiScale, 3 * uiScale, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.font = `black ${8 * uiScale}px Inter, sans-serif`;
      ctx.fillText('ACTIVE', hudX + 22 * uiScale, statusY + 13 * uiScale);

      // iOS Fix: Use Web Share API
      canvas.toBlob(async (blob) => {
        if (!blob) return;

        const file = new File([blob], `pose-${Date.now()}.png`, { type: 'image/png' });

        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({
              files: [file],
              title: 'Head Pose Capture',
            });
          } catch (err) {
            console.log('Share cancelled or failed', err);
          }
        } else {
          const link = document.createElement('a');
          link.download = `pose-${Date.now()}.png`;
          link.href = canvas.toDataURL('image/png');
          link.click();
        }
        setIsCapturing(false);
      }, 'image/png');

    } catch (err) {
      console.error("Screenshot failed:", err);
      setIsCapturing(false);
    }
  };

  useEffect(() => {
    // Corrected: Removed extra closing parenthesis in catch (err) statement
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
    <div className="flex items-center gap-2 leading-none py-0.5">
      <span className="text-[9px] font-bold text-white/40 uppercase tracking-tighter w-7">{label}</span>
      <span className={`text-[15px] font-mono font-bold ${color}`}>
        {value}<span className="text-[9px] ml-0.5 opacity-40 font-sans font-normal">{unit}</span>
      </span>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black flex items-center justify-center overflow-hidden select-none">
      <div className="relative w-full h-full bg-black flex flex-col overflow-hidden">
        
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
          style={{ transform: 'scaleX(-1)' }}
        />

        {/* Capture Button - Bottom Center */}
        <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-30">
          <button 
            onClick={takeScreenshot}
            disabled={isCapturing}
            className={`w-16 h-16 rounded-full bg-white/10 backdrop-blur-3xl border-2 border-white/20 flex items-center justify-center text-white active:scale-90 active:bg-white/20 transition-all shadow-2xl group ${isCapturing ? 'opacity-50' : ''}`}
          >
            <div className="w-12 h-12 rounded-full border border-white/40 flex items-center justify-center">
              <div className={`w-9 h-9 bg-white rounded-full ${isCapturing ? 'animate-pulse' : ''}`}></div>
            </div>
          </button>
        </div>

        {/* HUD - Top Left */}
        {!isLoading && !error && (
          <div className="absolute left-4 top-4 pointer-events-none flex flex-col gap-2.5 z-20">
            <div className="flex flex-col gap-1.5 backdrop-blur-3xl bg-black/40 p-4 rounded-2xl border border-white/5 shadow-2xl min-w-[110px]">
              <DataItem label="Yaw" value={Math.abs(pose.yaw)} color="text-emerald-400" />
              <DataItem label="Pit" value={Math.abs(pose.pitch)} color="text-sky-400" />
              <DataItem label="Rol" value={Math.abs(pose.roll)} color="text-violet-400" />
              <div className="h-px w-full bg-white/5 my-0.5"></div>
              <DataItem label="Dst" value={pose.distance} color="text-amber-400" unit="cm" />
              <DataItem label="Vol" value={pose.volume || 0} color="text-pink-400" unit="dB" />
            </div>

            <div className="flex items-center gap-1.5 px-2.5 py-0.5 bg-black/30 backdrop-blur-md rounded-full border border-white/5 w-fit ml-0.5">
              <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${pose.volume && pose.volume > 50 ? 'bg-pink-500' : 'bg-emerald-500'}`}></div>
              <span className="text-[8px] font-black text-white/30 uppercase tracking-[0.2em]">Active</span>
            </div>
          </div>
        )}

        {/* Loading/Error States */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black z-40">
            <div className="flex flex-col items-center gap-4">
              <div className="w-6 h-6 border-2 border-white/10 border-t-white rounded-full animate-spin"></div>
              <span className="text-white/20 text-[9px] font-black uppercase tracking-[0.4em]">Initializing</span>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/90 backdrop-blur-xl z-50 px-10 text-center">
            <div className="max-w-xs">
              <p className="text-red-400 text-xs font-bold uppercase tracking-widest mb-8 leading-relaxed">{error}</p>
              <button 
                onClick={() => window.location.reload()}
                className="w-full py-4 bg-white/5 hover:bg-white/10 text-white text-[10px] font-black uppercase rounded-2xl border border-white/10 transition-all shadow-xl"
              >
                Refresh
              </button>
            </div>
          </div>
        )}

        <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-black/20 via-transparent to-black/20"></div>
      </div>
    </div>
  );
};

export default App;
