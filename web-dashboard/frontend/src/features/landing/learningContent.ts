export type AnalysisKey = "material" | "digestion" | "recovery";
export type LearningStage = { title: string; description: string; labels: string[]; note: string };
export type AnalysisGuide = {
  key: AnalysisKey; name: string; question: string; summary: string;
  photo: "bauxite" | "laboratory" | "refinery"; method: string; dimension: string;
  inputs: string[]; outputs: string[]; use: string; limitation: string; stages: LearningStage[];
};

export const analysisGuides: AnalysisGuide[] = [
  {
    key: "material", name: "Material analysis", question: "What does my bauxite composition tell me?",
    summary: "Turn an oxide assay into an alumina-to-silica ratio, two distinct grade assessments and a chemistry cluster.",
    photo: "bauxite", method: "Random Forest + K-means", dimension: "8 measured oxides",
    inputs: ["Al₂O₃", "SiO₂", "Fe₂O₃", "TiO₂", "CaO", "MgO", "K₂O", "Na₂O"],
    outputs: ["A/S ratio", "Rule-based grade", "Classifier grade", "Cluster ID"],
    use: "Start here when you have an oxide assay and want to understand the material before exploring a process experiment.",
    limitation: "The classifier learns labels derived from chemistry. Neither its grade nor a cluster ID establishes commercial ore quality.",
    stages: [
      { title: "Start with the assay", description: "Enter all eight measured oxide weight percentages. The server checks finite values, a total no greater than 100%, and silica of at least 0.001 wt%.",
        labels: ["8 measurements", "Weight percent", "Validated total"], note: "A blank field is not a measured zero. This tool does not extract chemistry from a photograph." },
      { title: "Prepare three paths", description: "The adapter orders the eight oxides. The classifier receives that row directly; the clustering path uses its saved scaler. A/S is calculated separately from alumina divided by silica.",
        labels: ["Ordered oxide row", "Saved clustering scaler", "Al₂O₃ ÷ SiO₂"], note: "Scaling changes the numerical representation, not the measurement units shown to you. PCA is present in the bundle but is not used by this endpoint." },
      { title: "Classify and group", description: "The Random Forest combines class probabilities from its decision trees to choose a grade. K-means assigns the scaled composition to one of four learned clusters. The deterministic A/S thresholds provide an independent calculation alongside the classifier.",
        labels: ["Random Forest → grade", "K-means → cluster 0–3", "A/S thresholds → rule grade"], note: "Cluster numbers are identifiers, not an ordered quality score. The classifier can disagree with the threshold grade." },
      { title: "Read the result together", description: "The result reports the ratio, both grades, any disagreement and the cluster ID. After validation, the server stores these outputs with your inputs and the exact model version.",
        labels: ["Ratio + two grades", "Disagreement disclosed", "Versioned record"], note: "Classifier probability is uncalibrated; it is not a confidence guarantee about industrial performance." },
    ],
  },
  {
    key: "digestion", name: "Digestion", question: "How might alumina respond in my experiment?",
    summary: "Explore estimated alumina digestion efficiency for a supported laboratory experiment and measured feed chemistry.",
    photo: "laboratory", method: "StandardScaler → Ridge", dimension: "15 encoded features",
    inputs: ["Al₂O₃ + SiO₂", "Roasted / unroasted feed", "One experiment mode", "Applicable conditions"],
    outputs: ["Digestion efficiency (%)", "Input snapshot", "Validation notes", "Model identity"],
    use: "Use when you know the feed chemistry and the conditions of one supported experiment. A Material prediction is not required.",
    limitation: "The small laboratory dataset and weak grouped validation limit generalization. This is not an optimizer for arbitrary combined process settings.",
    stages: [
      { title: "Choose one experiment", description: "Supply alumina, silica and feed state. Select roasting, lime, caustic concentration, digestion temperature or digestion time, then enter only that mode’s applicable conditions.",
        labels: ["Feed chemistry", "Feed state", "1 of 5 modes"], note: "Unroasted feed in roasting mode can represent the baseline without roasting conditions. Do not combine every process control into one unsupported recipe." },
      { title: "Encode what is present", description: "The adapter builds 15 values: three feed/chemistry fields plus six presence/value pairs. Each pair records whether a factor is present and its value, preserving the difference between absence and a measured zero.",
        labels: ["3 feed fields", "6 presence flags", "6 factor values"], note: "For lime, present zero is [1, 0]; an absent factor is [0, 0]. The server constructs this representation, not the browser." },
      { title: "Scale, then estimate", description: "The saved StandardScaler applies the training transformation. Ridge regression combines those scaled features using learned weights and an intercept. Its L2 penalty was used during training to constrain the weights.",
        labels: ["Saved scaling", "Ridge · α = 1", "One numeric estimate"], note: "The exported model uses alpha 1, not the alpha 10 alternative reported in some older evaluations. Submitting an analysis does not train it again." },
      { title: "Validate the percentage", description: "The output must be finite and between 0 and 100%. A valid estimate is recorded with its inputs, version and limitations; invalid outputs are rejected rather than clipped into range.",
        labels: ["Digestion efficiency", "Finite, 0–100%", "Persist before display"], note: "Efficiency is a percentage target, not recovered kilograms or a guarantee for a new plant or feed." },
    ],
  },
  {
    key: "recovery", name: "Metal recovery", question: "What about lithium, gallium and scandium?",
    summary: "Estimate three extraction efficiencies from measured bauxite trace-metal concentrations and a supported experimental mode.",
    photo: "refinery", method: "3 separate Ridge pipelines", dimension: "6 features per element",
    inputs: ["Li concentration", "Ga concentration", "Sc concentration", "One experiment mode"],
    outputs: ["Li extraction (%)", "Ga extraction (%)", "Sc extraction (%)", "One validated bundle"],
    use: "Choose this tool when you have all three bauxite concentrations in µg/g. Ore grades and digestion estimates cannot supply those measurements.",
    limitation: "Recorded predictive performance is weak. Extraction efficiency does not establish purity, recoverable mass or economic feasibility.",
    stages: [
      { title: "Measure all three metals", description: "Supply the lithium, gallium and scandium concentrations measured in bauxite, in micrograms per gram. Choose roasting, lime or digestion-temperature mode.",
        labels: ["Li · µg/g", "Ga · µg/g", "Sc · µg/g"], note: "Do not substitute red-mud concentrations. Lime and temperature modes require their corresponding measured condition." },
      { title: "Build an element-specific row", description: "Each element gets six features: its own concentration, three mode indicators, lime percentage and digestion temperature. Only one mode indicator is active.",
        labels: ["1 concentration", "3 mode flags", "2 condition slots"], note: "The roasting mode is a category: this artifact has no continuous roasting temperature or time feature. It cannot distinguish roasting recipes." },
      { title: "Run three learned pipelines", description: "Each element has its own StandardScaler and Ridge regressor, with alpha 5. The three estimates use the selected experimental mode but different concentrations and learned model weights.",
        labels: ["Li → scaler → Ridge", "Ga → scaler → Ridge", "Sc → scaler → Ridge"], note: "All three exported estimators are Ridge. The Sc Random Forest score found in earlier comparisons does not describe the served model." },
      { title: "Accept all three or none", description: "The server validates all three percentages before committing one prediction. If any output is invalid, no partial-success bundle is stored.",
        labels: ["3 extraction percentages", "All-or-fail validation", "One immutable record"], note: "The output is an experimental efficiency estimate, not a recommendation to recover or skip an element." },
    ],
  },
];

export const glossary = [
  { term: "A/S ratio", category: "Material", explanation: "Alumina weight percentage divided by silica weight percentage. The application separately labels ratios below 4 as low, 4 to below 6 as medium, and 6 or above as high." },
  { term: "Feature", category: "Models", explanation: "A numeric input in the ordered representation an estimator expects. One form field may produce more than one feature, such as a presence flag plus a value." },
  { term: "StandardScaler", category: "Models", explanation: "A saved transformation that centers features using training means and scales them using training standard deviations. New requests reuse those learned values." },
  { term: "Random Forest", category: "Models", explanation: "An ensemble of decision trees. The Material classifier combines their class probabilities to choose a chemistry-derived grade." },
  { term: "K-means cluster", category: "Material", explanation: "A group represented by a learned center in scaled chemistry space. The application returns an ID from 0 to 3, not a named ore type or profitability ranking." },
  { term: "Ridge regression", category: "Models", explanation: "A linear regression trained with an L2 penalty on its weights. Digestion uses alpha 1; the three metal estimators use alpha 5." },
  { term: "MAE", category: "Evidence", explanation: "Mean absolute error: an average absolute prediction error in the evaluation data. For efficiency, it is measured in percentage points. It is not an individual prediction interval." },
  { term: "R²", category: "Evidence", explanation: "A regression score comparing squared prediction error with a mean-based baseline. Negative values mean the evaluated predictions perform worse than that baseline; it is not a percentage accuracy." },
  { term: "Recorded analysis", category: "Records", explanation: "An immutable server prediction containing the inputs, validated outputs, model version, owner and completion time. It appears in History after a successful commit." },
  { term: "Scenario", category: "Records", explanation: "A name and description pointing to an owned recorded analysis. Saving or renaming a scenario does not rerun a model or change that analysis." },
  { term: "Model version", category: "Records", explanation: "The recorded identity connecting an artifact digest, adapter and output schema. Historical predictions retain their original version even when another version is enabled." },
  { term: "Idempotency key", category: "Records", explanation: "An identifier attached to a deliberate analysis request. An identical retry returns the same completed prediction; reusing it with different input produces a conflict." },
];
