
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
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1080 },
          height: { ideal: 1920 },
        },
        audio: true
      });
      
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
      setError("无法访问摄像头或麦克风");
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
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.beginPath();
    // Adjusted screenshot overlay to be more compact
    ctx.roundRect(40, canvas.height - 320, 360, 280, 30);
    ctx.fill();
    
    // Draw HUD Data Text
    ctx.fillStyle = 'white';
    ctx.font = 'bold 36px sans-serif';
    ctx.fillText(`YAW: ${Math.abs(pose.yaw)}°`, 70, canvas.height - 260);
    ctx.fillText(`PIT: ${Math.abs(pose.pitch)}°`, 70, canvas.height - 215);
    ctx.fillText(`ROL: ${Math.abs(pose.roll)}°`, 70, canvas.height - 170);
    ctx.fillText(`VOL: ${pose.volume}dB`, 70, canvas.height - 125);
    ctx.fillText(`DST: ${pose.distance}cm`, 70, canvas.height - 80);

    const link = document.createElement('a');
    link.download = `pose-capture-${Date.now()}.png`;
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
        console.error(err);
        setError("初始化失败");
      }
    };
    init();
    return () => stopCapture();
  }, [setupSensors, startMonitoring]);

  const DataItem = ({ label, value, color, unit = "°" }: { label: string, value: number, color: string, unit?: string }) => (
    <div className="flex items-center gap-2">
      <span className="text-[9px] font-bold text-white/70 uppercase tracking-tight w-10">{label}</span>
      <span className={`text-sm font-mono font-bold ${color}`}>
        {value}<span className="text-[9px] ml-0.5 opacity-40 font-sans">{unit}</span>
      </span>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-neutral-950 flex items-center justify-center overflow-hidden select-none">
      <div className="relative h-full aspect-[9/16] max-h-screen w-auto bg-black shadow-2xl flex flex-col overflow-hidden">
        
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
          style={{ transform: 'scaleX(-1)' }}
        />

        {/* Action Controls (Top Right) */}
        <div className="absolute top-4 right-4 flex flex-col gap-3 pointer-events-none">
          <button 
            onClick={takeScreenshot}
            className="pointer-events-auto w-11 h-11 rounded-xl bg-white/10 backdrop-blur-xl border border-white/20 flex items-center justify-center text-white hover:bg-white/20 active:scale-90 transition-all shadow-lg"
            title="Take Screenshot"
          >
            <i className="fa-solid fa-camera text-base"></i>
          </button>
        </div>

        {/* Compact HUD Overlay - Moved closer to bottom-left */}
        {!isLoading && !error && (
          <div className="absolute inset-x-0 bottom-0 pointer-events-none p-4 pb-12 flex flex-col justify-end bg-gradient-to-t from-black/50 via-transparent to-transparent">
            <div className="flex flex-col gap-0.5 backdrop-blur-md bg-white/5 p-3 rounded-xl border border-white/10 self-start shadow-xl">
              <DataItem label="Yaw" value={Math.abs(pose.yaw)} color="text-emerald-400" />
              <DataItem label="Pitch" value={Math.abs(pose.pitch)} color="text-sky-400" />
              <DataItem label="Roll" value={Math.abs(pose.roll)} color="text-violet-400" />
              <div className="h-px w-full bg-white/10 my-1"></div>
              <DataItem label="Dist" value={pose.distance} color="text-amber-400" unit="cm" />
              <DataItem label="Vol" value={pose.volume || 0} color="text-pink-400" unit="dB" />
            </div>

            <div className="mt-2 flex items-center gap-1.5 self-start px-2 py-0.5 bg-white/5 rounded-full border border-white/5">
              <div className={`w-1 h-1 rounded-full animate-pulse ${pose.volume && pose.volume > 45 ? 'bg-pink-500' : 'bg-emerald-500'}`}></div>
              <span className="text-[7px] font-black text-white/30 uppercase tracking-[0.1em]">
                Live
              </span>
            </div>
          </div>
        )}

        {/* Status Feedback */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {isLoading && (
            <div className="flex flex-col items-center gap-3">
              <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
              <p className="text-white/40 text-[10px] font-bold uppercase tracking-[0.3em]">Initializing</p>
            </div>
          )}
          {error && (
            <div className="bg-black/60 backdrop-blur-md px-6 py-4 rounded-3xl border border-red-500/30 mx-6 shadow-2xl">
              <p className="text-red-400 text-[10px] font-bold uppercase tracking-widest text-center">{error}</p>
              <button 
                onClick={() => window.location.reload()}
                className="mt-3 w-full py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-[9px] font-bold uppercase tracking-tighter rounded-lg border border-red-500/20 pointer-events-auto transition-colors"
              >
                Retry
              </button>
            </div>
          )}
        </div>

        <div className="absolute inset-0 border border-white/5 pointer-events-none"></div>
      </div>
    </div>
  );
};

export default App;
