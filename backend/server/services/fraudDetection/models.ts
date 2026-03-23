import { fraudFeatureStore } from './featureStore';

interface ModelScore {
  score: number;
  confidence: number;
  factors: string[];
}

export class FraudDetectionModels {
  private modelWeights = {
    botDetection: 0.3,
    fakeProfile: 0.3,
    scamDetection: 0.25,
    reportScore: 0.15
  };

  async detectBot(userId: string): Promise<ModelScore> {
    const features = await fraudFeatureStore.collectUserFeatures(userId);
    const factors: string[] = [];
    let score = 0;

    if (features.swipeSpeed > 60) {
      score += 0.4;
      factors.push('Excessive swipe speed detected');
    } else if (features.swipeSpeed > 30) {
      score += 0.2;
    }

    if (features.messagesPerHour > 100) {
      score += 0.3;
      factors.push('Abnormal message rate detected');
    } else if (features.messagesPerHour > 50) {
      score += 0.15;
    }

    if (features.avgResponseDelay < 5) {
      score += 0.3;
      factors.push('Suspiciously fast response time');
    }

    if (features.accountAgeDays < 1) {
      score += 0.2;
      factors.push('New account with high activity');
    }

    if (features.photoCount === 1) {
      score += 0.1;
      factors.push('Only one photo');
    }

    if (features.bioLength < 20) {
      score += 0.1;
      factors.push('Minimal profile information');
    }

    if (features.activityScore < 0.3) {
      score += 0.15;
      factors.push('Low overall activity');
    }

    score = Math.min(score, 1);

    return {
      score,
      confidence: score > 0.5 ? 0.9 : 0.7,
      factors
    };
  }

  async detectFakeProfile(userId: string): Promise<ModelScore> {
    const features = await fraudFeatureStore.collectUserFeatures(userId);
    const factors: string[] = [];
    let score = 0;

    if (features.profileCompletion < 0.5) {
      score += 0.3;
      factors.push('Incomplete profile');
    }

    if (features.photoCount < 2) {
      score += 0.25;
      factors.push('Too few photos');
    }

    if (!features.hasFace) {
      score += 0.2;
      factors.push('No face detected in photos');
    }

    if (features.bioLength < 30) {
      score += 0.2;
      factors.push('Minimal or no bio');
    }

    if (features.accountAgeDays < 3) {
      score += 0.2;
      factors.push('Recently created account');
    }

    if (features.duplicatePhotoScore > 0.5) {
      score += 0.4;
      factors.push('Duplicate photos detected');
    }

    if (features.popularityScore > 0.8 && features.accountAgeDays < 7) {
      score += 0.15;
      factors.push('Suspiciously popular for new account');
    }

    if (features.behaviorScore > 0.8) {
      score -= 0.1;
    }

    score = Math.max(0, Math.min(score, 1));

    return {
      score,
      confidence: score > 0.5 ? 0.85 : 0.65,
      factors
    };
  }

  async detectScam(userId: string): Promise<ModelScore> {
    const features = await fraudFeatureStore.collectUserFeatures(userId);
    const factors: string[] = [];
    let score = 0;

    if (features.scamKeywordScore > 0.3) {
      score += 0.5;
      factors.push('Scam keywords detected in messages');
    } else if (features.scamKeywordScore > 0.1) {
      score += 0.25;
    }

    if (features.externalLinkCount > 3) {
      score += 0.4;
      factors.push('Multiple external links sent');
    } else if (features.externalLinkCount > 0) {
      score += 0.2;
    }

    if (features.matchRate > 0.5) {
      score += 0.2;
      factors.push('Unusually high match rate');
    }

    if (features.reportCount > 0) {
      score += Math.min(features.reportCount * 0.2, 0.4);
      factors.push('Previous reports on account');
    }

    if (features.accountAgeDays < 7) {
      score += 0.15;
      factors.push('New account with suspicious activity');
    }

    score = Math.min(score, 1);

    return {
      score,
      confidence: score > 0.4 ? 0.9 : 0.7,
      factors
    };
  }

  async calculateReportScore(userId: string): Promise<ModelScore> {
    const features = await fraudFeatureStore.collectUserFeatures(userId);
    const factors: string[] = [];
    let score = 0;

    const reportWeights: Record<string, number> = {
      scam: 0.4,
      fake_profile: 0.35,
      harassment: 0.3,
      inappropriate_photos: 0.25,
      spam: 0.2,
      underage: 0.5,
      other: 0.1
    };

    score = Math.min(features.reportCount * 0.15, 0.6);
    
    if (features.reportCount > 0) {
      factors.push(`${features.reportCount} user reports`);
    }

    score = Math.min(score, 1);

    return {
      score,
      confidence: score > 0.3 ? 0.95 : 0.7,
      factors
    };
  }

  async getCombinedRiskScore(userId: string): Promise<{
    overallScore: number;
    botScore: number;
    fakeProfileScore: number;
    scamScore: number;
    reportScore: number;
    recommendation: 'allow' | 'monitor' | 'warning' | 'shadow_ban' | 'permanent_ban';
    factors: string[];
  }> {
    const [botScore, fakeProfileScore, scamScore, reportScore] = await Promise.all([
      this.detectBot(userId),
      this.detectFakeProfile(userId),
      this.detectScam(userId),
      this.calculateReportScore(userId)
    ]);

    const overallScore = 
      botScore.score * this.modelWeights.botDetection +
      fakeProfileScore.score * this.modelWeights.fakeProfile +
      scamScore.score * this.modelWeights.scamDetection +
      reportScore.score * this.modelWeights.reportScore;

    const allFactors = [
      ...botScore.factors,
      ...fakeProfileScore.factors,
      ...scamScore.factors,
      ...reportScore.factors
    ];

    let recommendation: 'allow' | 'monitor' | 'warning' | 'shadow_ban' | 'permanent_ban';
    
    if (overallScore < 0.3) {
      recommendation = 'allow';
    } else if (overallScore < 0.5) {
      recommendation = 'monitor';
    } else if (overallScore < 0.7) {
      recommendation = 'warning';
    } else if (overallScore < 0.85) {
      recommendation = 'shadow_ban';
    } else {
      recommendation = 'permanent_ban';
    }

    return {
      overallScore: Math.round(overallScore * 100) / 100,
      botScore: Math.round(botScore.score * 100) / 100,
      fakeProfileScore: Math.round(fakeProfileScore.score * 100) / 100,
      scamScore: Math.round(scamScore.score * 100) / 100,
      reportScore: Math.round(reportScore.score * 100) / 100,
      recommendation,
      factors: [...new Set(allFactors)]
    };
  }
}

export const fraudDetectionModels = new FraudDetectionModels();
