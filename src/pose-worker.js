let model;
self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try {
      // A dynamic import keeps this entry valid in Vite's classic-worker dev mode.
      // The classic worker is required by MediaPipe's synchronous WASM loader.
      const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
      const files = await FilesetResolver.forVisionTasks('/wasm');
      model = await PoseLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: '/models/pose_landmarker_lite.task', delegate: 'CPU' },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.6,
        minTrackingConfidence: 0.6,
        outputSegmentationMasks: false,
      });
      self.postMessage({ type: 'ready' });
    } catch (error) {
      console.error('Posture initialization failed:', error.message);
      self.postMessage({
        type: 'error',
        message:
          'Posture model could not load. Check the local model files and browser support. Recording is still available.',
      });
    }
  }
  if (data.type === 'frame') {
    try {
      const result = model.detectForVideo(data.bitmap, data.time);
      self.postMessage({
        type: 'pose',
        landmarks: result.landmarks[0] || null,
        worldLandmarks: result.worldLandmarks[0] || null,
        aspectRatio: data.bitmap.width / data.bitmap.height,
        time: data.time,
      });
    } catch {
      self.postMessage({ type: 'pose', landmarks: null, time: data.time });
    } finally {
      data.bitmap.close();
    }
  }
};
