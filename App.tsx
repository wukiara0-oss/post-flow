
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

    // Draw HUD Data Background (Smaller in screenshot too)
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
    link.download = `pose-${Date.now()}.png`;
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
    <div className="flex items-center gap-1.5 leading-none">
      <span className="text-[8px] font-bold text-white/50 uppercase tracking-tighter w-8">{label}</span>
      <span className={`text-[13px] font-mono font-bold ${color}`}>
        {value}<span className="text-[8px] ml-0.5 opacity-30 font-sans font-normal">{unit}</span>
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
        <div className="absolute top-4 right-4 pointer-events-none">
          <button 
            onClick={takeScreenshot}
            className="pointer-events-auto w-10 h-10 rounded-xl bg-black/40 backdrop-blur-xl border border-white/10 flex items-center justify-center text-white hover:bg-white/10 active:scale-90 transition-all shadow-lg"
            title="Take Screenshot"
          >
            <i className="fa-solid fa-camera text-sm"></i>
          </button>
        </div>

        {/* HUD Overlay - Bottom-Left Positioned & Compact */}
        {!isLoading && !error && (
          <div className="absolute left-3 bottom-3 pointer-events-none flex flex-col gap-2">
            <div className="flex flex-col gap-1.5 backdrop-blur-xl bg-black/40 p-2.5 rounded-xl border border-white/10 shadow-2xl">
              <DataItem label="Yaw" value={Math.abs(pose.yaw)} color="text-emerald-400" />
              <DataItem label="Pit" value={Math.abs(pose.pitch)} color="text-sky-400" />
              <DataItem label="Rol" value={Math.abs(pose.roll)} color="text-violet-400" />
              <div className="h-px w-full bg-white/10 my-0.5"></div>
              <DataItem label="Dst" value={pose.distance} color="text-amber-400" unit="cm" />
              <DataItem label="Vol" value={pose.volume || 0} color="text-pink-400" unit="dB" />
            </div>

            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-black/40 backdrop-blur-md rounded-full border border-white/5 w-fit">
              <div className={`w-1 h-1 rounded-full animate-pulse ${pose.volume && pose.volume > 45 ? 'bg-pink-500' : 'bg-emerald-500'}`}></div>
              <span className="text-[7px] font-black text-white/30 uppercase tracking-widest">Live</span>
            </div>
          </div>
        )}

        {/* Loader/Error Displays */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {isLoading && (
            <div className="flex flex-col items-center gap-2">
              <div className="w-4 h-4 border-2 border-white/10 border-t-white/80 rounded-full animate-spin"></div>
              <span className="text-white/30 text-[8px] font-black uppercase tracking-[0.4em]">Booting</span>
            </div>
          )}
          {error && (
            <div className="bg-black/80 backdrop-blur-2xl px-5 py-4 rounded-2xl border border-red-500/20 mx-6 text-center">
              <p className="text-red-400 text-[9px] font-bold uppercase tracking-widest mb-3">{error}</p>
              <button 
                onClick={() => window.location.reload()}
                className="px-4 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-[8px] font-black uppercase rounded-lg border border-red-500/20 pointer-events-auto transition-all"
              >
                Restart
              </button>
            </div>
          )}
        </div>

        {/* Ambient Overlay */}
        <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-black/20 to-transparent"></div>
      </div>
    </div>
  );
};

export default App;
