
export interface HeadPose {
  pitch: number; // Up/Down (X-axis)
  yaw: number;   // Left/Right (Y-axis)
  roll: number;  // Tilt (Z-axis)
  distance: number; // Distance from camera (cm/relative)
  volume?: number; // Audio volume in dB
}

export enum PoseStatus {
  Neutral = 'Neutral',
  LookingLeft = 'Looking Left',
  LookingRight = 'Looking Right',
  LookingUp = 'Looking Up',
  LookingDown = 'Looking Down',
  TiltingLeft = 'Tilting Left',
  TiltingRight = 'Tilting Right'
}
