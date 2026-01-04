
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

      // CRITICAL: Use window dimensions to match the physical screen aspect ratio exactly
      const screenW = window.innerWidth;
      const screenH = window.innerHeight;
      
      // Use higher resolution for the saved image (2x for retina-like quality)
      const dpr = 2; 
      canvas.width = screenW * dpr;
      canvas.height = screenH * dpr;

      // 1. Draw Video background (mimic object-cover)
      const vW = video.videoWidth;
      const vH = video.videoHeight;
      const videoRatio = vW / vH;
      const screenRatio = screenW / screenH;
      
      let sx, sy, sW, sH;
      if (videoRatio > screenRatio) {
        // Video is wider than screen
        sH = vH;
        sW = vH * screenRatio;
        sx = (vW - sW) / 2;
        sy = 0;
      } else {
        // Video is taller than screen
        sW = vW;
        sH = vW / screenRatio;
        sx = 0;
        sy = (vH - sH) / 2;
      }

      ctx.save();
      ctx.scale(-1, 1); // Flip for selfie mode
      ctx.drawImage(video, sx, sy, sW, sH, -canvas.width, 0, canvas.width, canvas.height);
      ctx.restore();

      // 2. Draw HUD (Top Left Overlay)
      const uiScale = (canvas.width / 400); 
      const margin = 16 * uiScale;
      const panelW = 120 * uiScale;
      const panelH = 165 * uiScale;
      const cornerRadius = 20 * uiScale;

      // Background Panel
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.beginPath();
      ctx.roundRect(margin, margin, panelW, panelH, cornerRadius);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = 1 * uiScale;
      ctx.stroke();

      // Text items
      const drawTextItem = (label: string, value: string, color: string, y: number) => {
        // Label
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.font = `bold ${9 * uiScale}px Inter, -apple-system, sans-serif`;
        ctx.fillText(label.toUpperCase(), margin + 14 * uiScale, y);
        
        // Value
        ctx.fillStyle = color;
        ctx.font = `bold ${15 * uiScale}px monospace`;
        ctx.fillText(value, margin + 44 * uiScale, y);
      };

      const startY = margin + 36 * uiScale;
      const gap = 26 * uiScale;

      drawTextItem('Yaw', `${Math.abs(pose.yaw)}°`, '#34d399', startY);
      drawTextItem('Pit', `${Math.abs(pose.pitch)}°`, '#38bdf8', startY + gap);
      drawTextItem('Rol', `${Math.abs(pose.roll)}°`, '#a78bfa', startY + gap * 2);

      // Separator
      ctx.beginPath();
      ctx.moveTo(margin + 14 * uiScale, startY + gap * 2.4);
      ctx.lineTo(margin + panelW - 14 * uiScale, startY + gap * 2.4);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1 * uiScale;
      ctx.stroke();

      drawTextItem('Dst', `${pose.distance}cm`, '#fbbf24', startY + gap * 3.1);
      drawTextItem('Vol', `${pose.volume}dB`, '#f472b6', startY + gap * 4.1);

      // 3. Status Indicator
      const statusY = margin + panelH + 12 * uiScale;
      const statusW = 75 * uiScale;
      const statusH = 22 * uiScale;
      
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.beginPath();
      ctx.roundRect(margin, statusY, statusW, statusH, 11 * uiScale);
      ctx.fill();
      
      // Indicator Dot
      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.arc(margin + 12 * uiScale, statusY + 11 * uiScale, 3 * uiScale, 0, Math.PI * 2);
      ctx.fill();

      // Label
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.font = `900 ${8 * uiScale}px Inter, sans-serif`;
      ctx.fillText('ACTIVE', margin + 22 * uiScale, statusY + 14 * uiScale);

      // iOS Save Logic
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        const file = new File([blob], `pose-capture-${Date.now()}.png`, { type: 'image/png' });

        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({
              files: [file],
              title: 'Head Pose Detection',
            });
          } catch (err) {
            console.log('Share error or cancelled', err);
          }
        } else {
          const link = document.createElement('a');
          link.download = `pose-capture-${Date.now()}.png`;
          link.href = canvas.toDataURL('image/png');
          link.click();
        }
        setIsCapturing(false);
      }, 'image/png', 1.0);

    } catch (err) {
      console.error("Capture process failed:", err);
      setIsCapturing(false);
    }
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

        {/* Capture Button */}
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

        {/* HUD - Top Left Overlay */}
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

        {/* States Overlay */}
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
              <button onClick={() => window.location.reload()} className="w-full py-4 bg-white/5 hover:bg-white/10 text-white text-[10px] font-black uppercase rounded-2xl border border-white/10 transition-all shadow-xl">Refresh</button>
            </div>
          </div>
        )}

        <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-black/20 via-transparent to-black/20"></div>
      </div>
    </div>
  );
};

export default App;
