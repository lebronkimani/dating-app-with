import { getPool } from '../../db/init';
import { moderationService } from '../moderation';

interface NudityResult {
  detected: boolean;
  confidence: number;
  hasNudity: boolean;
  hasSexualContent: boolean;
  hasExplicitContent: boolean;
  bodyRegions: {
    region: string;
    detected: boolean;
    confidence: number;
  }[];
  labels: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
  action?: 'warn' | 'ban' | 'remove' | 'flag';
}

export class NudityDetectionService {
  private enabled: boolean = false;
  private azureKey: string | undefined;
  private googleKey: string | undefined;

  constructor() {
    this.azureKey = process.env.AZURE_CONTENT_SAFETY_KEY;
    this.googleKey = process.env.GOOGLE_VISION_KEY;
    this.enabled = !!(this.azureKey || this.googleKey);
  }

  async analyzeImage(imageUrl: string, userId: string): Promise<NudityResult> {
    const pool = getPool();
    
    if (!this.enabled) {
      const basicResult = await this.basicImageCheck(imageUrl);
      await this.logAnalysis(pool, userId, imageUrl, basicResult);
      return basicResult;
    }

    try {
      let result: NudityResult;

      if (this.azureKey) {
        result = await this.analyzeWithAzure(imageUrl);
      } else if (this.googleKey) {
        result = await this.analyzeWithGoogleVision(imageUrl);
      } else {
        result = await this.basicImageCheck(imageUrl);
      }

      await this.logAnalysis(pool, userId, imageUrl, result);

      if (result.action === 'ban') {
        await moderationService.handleViolation({
          userId,
          type: 'explicit_content',
          severity: result.severity,
          source: 'ai_detection',
          description: `Nudity detected: ${result.labels.join(', ')}`
        });
      }

      return result;
    } catch (error) {
      console.error('Nudity detection error:', error);
      return {
        detected: false,
        confidence: 0,
        hasNudity: false,
        hasSexualContent: false,
        hasExplicitContent: false,
        bodyRegions: [],
        labels: ['analysis_error'],
        severity: 'low'
      };
    }
  }

  async analyzeProfilePhotos(userId: string): Promise<{ hasViolation: boolean; results: NudityResult[] }> {
    const pool = getPool();
    
    const result = await pool.query(
      `SELECT images FROM users WHERE id = $1`,
      [userId]
    );

    const images = result.rows[0]?.images || [];
    const results: NudityResult[] = [];

    for (const imageUrl of images) {
      const analysis = await this.analyzeImage(imageUrl, userId);
      results.push(analysis);
    }

    const hasViolation = results.some(r => r.action === 'ban' || r.action === 'remove');

    return { hasViolation, results };
  }

  private async analyzeWithAzure(imageUrl: string): Promise<NudityResult> {
    const endpoint = process.env.AZURE_CONTENT_SAFETY_ENDPOINT;
    
    const response = await fetch(`${endpoint}/contentsafety/image:analyze?api-version=2024-09-01`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': this.azureKey!,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        image: { source: { url: imageUrl } },
        categories: ["Sexual"]
      })
    });

    if (!response.ok) {
      throw new Error(`Azure API error: ${response.status}`);
    }

    const data = await response.json() as any;
    const sexual = data.categoriesAnalysis?.find((c: any) => c.category === "Sexual");

    return this.mapAzureResult(sexual);
  }

  private async analyzeWithGoogleVision(imageUrl: string): Promise<NudityResult> {
    const response = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${this.googleKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          image: { source: { imageUri: imageUrl } },
          features: [
            { type: "SAFE_SEARCH_DETECTION" },
            { type: "LABEL_DETECTION" }
          ]
        }]
      })
    });

    if (!response.ok) {
      throw new Error(`Google Vision API error: ${response.status}`);
    }

    const data = await response.json() as any;
    const safeSearch = data.responses?.[0]?.safeSearchAnnotation;
    const labels = data.responses?.[0]?.labelAnnotations || [];

    return this.mapGoogleResult(safeSearch, labels);
  }

  private mapAzureResult(sexual: any): NudityResult {
    const severity = sexual?.severity || 0;
    const confidence = sexual?.detectionScore || 0;
    
    const bodyRegions: NudityResult['bodyRegions'] = [
      { region: 'genitals', detected: severity >= 6, confidence: severity >= 6 ? confidence : 0 },
      { region: 'breasts', detected: severity >= 5, confidence: severity >= 5 ? confidence : 0 },
      { region: 'buttocks', detected: severity >= 5, confidence: severity >= 5 ? confidence : 0 }
    ];

    if (severity >= 6) {
      return {
        detected: true,
        confidence,
        hasNudity: true,
        hasSexualContent: true,
        hasExplicitContent: true,
        bodyRegions,
        labels: ['explicit_nudity', 'sexual_content'],
        severity: 'critical',
        action: 'ban'
      };
    } else if (severity >= 4) {
      return {
        detected: true,
        confidence,
        hasNudity: true,
        hasSexualContent: true,
        hasExplicitContent: false,
        bodyRegions,
        labels: ['nudity', 'sexual_content'],
        severity: 'high',
        action: 'remove'
      };
    } else if (severity >= 2) {
      return {
        detected: false,
        confidence,
        hasNudity: false,
        hasSexualContent: false,
        hasExplicitContent: false,
        bodyRegions,
        labels: ['possibly_suggestive'],
        severity: 'low',
        action: 'flag'
      };
    }

    return {
      detected: false,
      confidence: 1 - confidence,
      hasNudity: false,
      hasSexualContent: false,
      hasExplicitContent: false,
      bodyRegions,
      labels: ['safe'],
      severity: 'low'
    };
  }

  private mapGoogleResult(safeSearch: any, labels: any[]): NudityResult {
    const mapLevel = (level: string): number => {
      const levels: Record<string, number> = { UNKNOWN: 0, VERY_UNLIKELY: 1, UNLIKELY: 2, POSSIBLE: 3, LIKELY: 4, VERY_LIKELY: 5 };
      return levels[level] || 0;
    };

    const adult = mapLevel(safeSearch?.adult);
    const violence = mapLevel(safeSearch?.violence);
    const racy = mapLevel(safeSearch?.racy);
    const gore = mapLevel(safeSearch?.violence);

    const maxScore = Math.max(adult, violence, racy, gore);

    const bodyRegions: NudityResult['bodyRegions'] = [];
    
    if (adult >= 3 || racy >= 4) {
      bodyRegions.push({ region: 'explicit', detected: adult >= 5, confidence: adult / 5 });
    }

    const labelTexts = labels?.map((l: any) => l.description?.toLowerCase() || '') || [];
    const hasUnderwear = labelTexts.some(t => t.includes('underwear') || t.includes('bikini') || t.includes('swimwear'));
    const hasNude = labelTexts.some(t => t.includes('nude') || t.includes('naked'));

    if (adult >= 4 || (hasNude && adult >= 3)) {
      return {
        detected: true,
        confidence: adult / 5,
        hasNudity: true,
        hasSexualContent: racy >= 4,
        hasExplicitContent: adult >= 5,
        bodyRegions,
        labels: this.getLabels(adult, racy, gore, labelTexts),
        severity: adult >= 5 ? 'critical' : 'high',
        action: adult >= 5 ? 'ban' : 'remove'
      };
    } else if (adult >= 3 || racy >= 3 || hasUnderwear) {
      return {
        detected: false,
        confidence: maxScore / 5,
        hasNudity: false,
        hasSexualContent: racy >= 3,
        hasExplicitContent: false,
        bodyRegions,
        labels: this.getLabels(adult, racy, gore, labelTexts),
        severity: 'medium',
        action: 'flag'
      };
    }

    return {
      detected: false,
      confidence: 1 - (maxScore / 5),
      hasNudity: false,
      hasSexualContent: false,
      hasExplicitContent: false,
      bodyRegions,
      labels: ['safe'],
      severity: 'low'
    };
  }

  private getLabels(adult: number, racy: number, gore: number, labelTexts: string[]): string[] {
    const labels: string[] = [];
    if (adult >= 3) labels.push('adult');
    if (racy >= 3) labels.push('racy');
    if (gore >= 3) labels.push('gore');
    labelTexts.forEach(t => {
      if (t.includes('nude') || t.includes('naked')) labels.push('nudity');
      if (t.includes('underwear')) labels.push('underwear');
    });
    return labels.length > 0 ? labels : ['safe'];
  }

  private async basicImageCheck(imageUrl: string): Promise<NudityResult> {
    return {
      detected: false,
      confidence: 0.5,
      hasNudity: false,
      hasSexualContent: false,
      hasExplicitContent: false,
      bodyRegions: [],
      labels: ['no_api'],
      severity: 'low'
    };
  }

  private async logAnalysis(pool: any, userId: string, imageUrl: string, result: NudityResult): Promise<void> {
    await pool.query(
      `INSERT INTO content_moderation_queue (content_type, content_id, user_id, content_url, status, ai_confidence, ai_labels)
       VALUES ('photo', $1, $2, $3, $4, $5, $6)`,
      [userId, userId, imageUrl, result.detected ? 'rejected' : 'approved', result.confidence, JSON.stringify(result.labels)]
    );
  }
}

export const nudityDetectionService = new NudityDetectionService();
