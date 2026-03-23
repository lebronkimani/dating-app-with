import * as faceapi from 'face-api';

export interface FaceDetection {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FaceMatch {
  verified: boolean;
  confidence: number;
}

export class FaceVerificationService {
  private modelsLoaded = false;
  private modelsPath = '/models';

  async loadModels(): Promise<void> {
    if (this.modelsLoaded) return;

    try {
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(this.modelsPath),
        faceapi.nets.faceLandmark68Net.loadFromUri(this.modelsPath),
        faceapi.nets.faceRecognitionNet.loadFromUri(this.modelsPath),
      ]);
      this.modelsLoaded = true;
      console.log('Face recognition models loaded');
    } catch (error) {
      console.error('Failed to load face models:', error);
      throw error;
    }
  }

  async detectFace(imageElement: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement): Promise<FaceDetection | null> {
    const detection = await faceapi
      .detectSingleFace(imageElement, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks();

    if (!detection) return null;

    return {
      x: detection.detection.box.x,
      y: detection.detection.box.y,
      width: detection.detection.box.width,
      height: detection.detection.box.height,
    };
  }

  async getFaceDescriptor(imageElement: HTMLImageElement | HTMLCanvasElement): Promise<number[] | null> {
    const detection = await faceapi
      .detectSingleFace(imageElement, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!detection) return null;
    return Array.from(detection.descriptor);
  }

  async compareFaces(
    referenceImage: HTMLImageElement | HTMLCanvasElement,
    verificationImage: HTMLImageElement | HTMLCanvasElement,
    threshold: number = 0.6
  ): Promise<FaceMatch> {
    await this.loadModels();

    const refDescriptor = await this.getFaceDescriptor(referenceImage);
    if (!refDescriptor) {
      return { verified: false, confidence: 0 };
    }

    const verDescriptor = await this.getFaceDescriptor(verificationImage);
    if (!verDescriptor) {
      return { verified: false, confidence: 0 };
    }

    const distance = faceapi.euclideanDistance(refDescriptor, verDescriptor);
    const confidence = 1 - distance;

    return {
      verified: confidence >= threshold,
      confidence: Math.round(confidence * 100) / 100,
    };
  }

  async compareWithMultipleImages(
    selfieImage: HTMLImageElement | HTMLCanvasElement,
    profileImages: (HTMLImageElement | HTMLCanvasElement)[],
    threshold: number = 0.5
  ): Promise<{ verified: boolean; bestMatch: number; message: string }> {
    await this.loadModels();

    if (profileImages.length === 0) {
      return { verified: false, bestMatch: 0, message: 'No profile images to compare' };
    }

    let bestMatch = 0;
    let matches = 0;

    for (const img of profileImages) {
      const result = await this.compareFaces(selfieImage, img, 0.3);
      if (result.confidence > bestMatch) {
        bestMatch = result.confidence;
      }
      if (result.verified) {
        matches++;
      }
    }

    const verified = bestMatch >= threshold || matches > 0;
    let message = '';

    if (verified) {
      message = `Match found! Confidence: ${(bestMatch * 100).toFixed(1)}%`;
    } else {
      message = `No match. Best confidence: ${(bestMatch * 100).toFixed(1)}% (need ${threshold * 100}%)`;
    }

    return { verified, bestMatch: Math.round(bestMatch * 100) / 100, message };
  }

  async detectMultipleFaces(imageElement: HTMLImageElement | HTMLCanvasElement): Promise<number> {
    const detections = await faceapi
      .detectAllFaces(imageElement, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks();

    return detections.length;
  }

  async analyzeFace(imageElement: HTMLImageElement | HTMLCanvasElement): Promise<{
    hasFace: boolean;
    faceCount: number;
    landmarks?: any;
  }> {
    await this.loadModels();

    const detections = await faceapi
      .detectAllFaces(imageElement, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks();

    return {
      hasFace: detections.length > 0,
      faceCount: detections.length,
      landmarks: detections[0]?.landmarks,
    };
  }
}

export const faceVerificationService = new FaceVerificationService();