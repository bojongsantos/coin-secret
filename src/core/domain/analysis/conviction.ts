export interface ConvictionComponent {
  id: string;
  label: string;
  detail: string;
  value: number;
  display: string;
  tone: "pass" | "warn" | "fail" | "info";
  /** Normalized quality 0..1 where higher is better (drives status dot color). */
  ratio: number;
}

export interface ConvictionScore {
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  interpretation: string;
  components: ConvictionComponent[];
}

export interface ConvictionInput {
  confidence: number;
  narrowness?: number;
  strength?: "fresh" | "tested" | "broken";
  touches?: number;
}

const BASE = 42;

export function gradeOfConviction(score: number): ConvictionScore["grade"] {
  if (score >= 80) return "A";
  if (score >= 65) return "B";
  if (score >= 50) return "C";
  if (score >= 35) return "D";
  return "F";
}

/**
 * A grade, said as a sentence.
 *
 * Stable English keys rather than finished copy: the card translates the grade
 * at render, the same way it translates every other value the domain produces.
 * The text here is the fallback when a caller has no message table to hand.
 */
const interpretationByGrade: Record<ConvictionScore["grade"], string> = {
  A: "High quality setup",
  B: "Worth considering",
  C: "Marginal setup",
  D: "Weak setup",
  F: "Not recommended",
};

/** Reconstruct the conviction breakdown from the same inputs the detector used. */
export function buildConviction(input: ConvictionInput): ConvictionScore {
  const { confidence, narrowness = 0, strength = "tested", touches = 0 } = input;

  const quality = Math.round(narrowness * 26);
  const freshness = strength === "fresh" ? 22 : strength === "tested" ? 8 : 0;
  const touchPenalty = -touches * 5;

  const components: ConvictionComponent[] = [
    {
      id: "quality",
      label: "Zone Quality",
      detail: `Zona sempit ${narrowness.toFixed(2)}x avg range`,
      value: quality,
      display: `+${quality}`,
      tone: quality >= 20 ? "pass" : quality >= 10 ? "warn" : "fail",
      ratio: quality / 26,
    },
    {
      id: "freshness",
      label: "Zone Freshness",
      detail:
        strength === "fresh"
          ? "Fresh - belum tersentuh"
          : strength === "tested"
            ? `Tested - ${touches} kali disentuh`
            : "Broken - zona ditembus",
      value: freshness,
      display: `+${freshness}`,
      tone: strength === "fresh" ? "pass" : strength === "tested" ? "warn" : "fail",
      ratio: freshness / 22,
    },
    {
      id: "touches",
      label: "Touch Penalty",
      detail: touches === 0 ? "0 touches" : `-${touches * 5} dari ${touches} touches`,
      value: touchPenalty,
      display: touchPenalty === 0 ? "0" : `${touchPenalty}`,
      tone: touches === 0 ? "pass" : touches <= 2 ? "warn" : "fail",
      ratio: touches === 0 ? 1 : touches === 1 ? 0.5 : touches === 2 ? 0.4 : 0.1,
    },
    {
      id: "base",
      label: "Base Score",
      detail: "Standar setiap zona terdeteksi",
      value: BASE,
      display: `+${BASE}`,
      tone: "info",
      ratio: 1,
    },
  ];

  const grade = gradeOfConviction(confidence);
  return {
    score: confidence,
    grade,
    interpretation: interpretationByGrade[grade],
    components,
  };
}
