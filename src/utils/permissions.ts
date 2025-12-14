/**
 * Permission utilities for checking and requesting media permissions
 */

type MediaPermissionName = 'camera' | 'microphone';

/**
 * Check if a permission is already granted
 */
export async function checkPermission(name: MediaPermissionName): Promise<boolean> {
  try {
    const result = await navigator.permissions.query({ name: name as PermissionName });
    return result.state === 'granted';
  } catch {
    // Permission API not supported or permission name not recognized
    return false;
  }
}

/**
 * Request camera permission by briefly accessing the camera
 * Returns true if permission granted, false if denied
 */
export async function requestCameraPermission(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    // Stop all tracks immediately after getting permission
    stream.getTracks().forEach(track => track.stop());
    return true;
  } catch {
    return false;
  }
}

/**
 * Request microphone permission by briefly accessing the microphone
 * Returns true if permission granted, false if denied
 */
export async function requestMicrophonePermission(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Stop all tracks immediately after getting permission
    stream.getTracks().forEach(track => track.stop());
    return true;
  } catch {
    return false;
  }
}
