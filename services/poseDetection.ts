
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { HeadPose } from '../types';

export class PoseDetectionService {
  private faceLandmarker: FaceLandmarker | null = null;

  async init() {
    const filesetResolver = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
    );
    this.faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
        delegate: "GPU"
      },
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      runningMode: "VIDEO",
      numFaces: 1
    });
  }

  detect(video: HTMLVideoElement, timestamp: number): HeadPose | null {
    if (!this.faceLandmarker) return null;

    const results = this.faceLandmarker.detectForVideo(video, timestamp);
    
    if (results.facialTransformationMatrixes && results.facialTransformationMatrixes.length > 0) {
      const matrix = results.facialTransformationMatrixes[0].data;
      
      // Euler angles (Degrees)
      let pitch = Math.asin(-matrix[6]) * (180 / Math.PI);
      let yaw = Math.atan2(matrix[2], matrix[10]) * (180 / Math.PI);
      let roll = Math.atan2(matrix[4], matrix[5]) * (180 / Math.PI);

      // Distance estimation using the Z translation component of the matrix
      // index 14 is the translation along Z axis. 
      // MediaPipe uses a coordinate system where Z increases away from the camera.
      let distance = Math.abs(matrix[14]);

      return {
        pitch: Math.round(pitch),
        yaw: Math.round(yaw),
        roll: Math.round(roll),
        distance: Math.round(distance)
      };
    }

    return null;
  }
}
