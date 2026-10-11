/**
 * RxNorm Drug Dictionary
 * Top common medications with normalized names, drug classes, and dosage forms.
 * Used for fuzzy matching OCR output against known drug names.
 */

export interface DrugEntry {
  name: string;
  aliases: string[];
  drugClass: string;
  forms: string[];
  commonDosages: string[];
}

/**
 * Top ~200 commonly prescribed medications organized by class.
 */
export const DRUG_DATABASE: DrugEntry[] = [
  // --- Cardiovascular ---
  { name: 'Lisinopril', aliases: ['zestril', 'prinivil'], drugClass: 'ACE Inhibitor', forms: ['tablet'], commonDosages: ['5mg', '10mg', '20mg', '40mg'] },
  { name: 'Amlodipine', aliases: ['norvasc'], drugClass: 'Calcium Channel Blocker', forms: ['tablet'], commonDosages: ['2.5mg', '5mg', '10mg'] },
  { name: 'Atorvastatin', aliases: ['lipitor'], drugClass: 'Statin', forms: ['tablet'], commonDosages: ['10mg', '20mg', '40mg', '80mg'] },
  { name: 'Metoprolol', aliases: ['lopressor', 'toprol'], drugClass: 'Beta Blocker', forms: ['tablet', 'extended-release'], commonDosages: ['25mg', '50mg', '100mg', '200mg'] },
  { name: 'Losartan', aliases: ['cozaar'], drugClass: 'ARB', forms: ['tablet'], commonDosages: ['25mg', '50mg', '100mg'] },
  { name: 'Hydrochlorothiazide', aliases: ['hctz', 'microzide'], drugClass: 'Diuretic', forms: ['tablet', 'capsule'], commonDosages: ['12.5mg', '25mg', '50mg'] },
  { name: 'Warfarin', aliases: ['coumadin', 'jantoven'], drugClass: 'Anticoagulant', forms: ['tablet'], commonDosages: ['1mg', '2mg', '2.5mg', '5mg', '7.5mg', '10mg'] },
  { name: 'Clopidogrel', aliases: ['plavix'], drugClass: 'Antiplatelet', forms: ['tablet'], commonDosages: ['75mg'] },
  { name: 'Furosemide', aliases: ['lasix'], drugClass: 'Loop Diuretic', forms: ['tablet', 'injection'], commonDosages: ['20mg', '40mg', '80mg'] },
  { name: 'Spironolactone', aliases: ['aldactone'], drugClass: 'Potassium-Sparing Diuretic', forms: ['tablet'], commonDosages: ['25mg', '50mg', '100mg'] },
  { name: 'Valsartan', aliases: ['diovan'], drugClass: 'ARB', forms: ['tablet'], commonDosages: ['40mg', '80mg', '160mg', '320mg'] },
  { name: 'Diltiazem', aliases: ['cardizem', 'tiazac'], drugClass: 'Calcium Channel Blocker', forms: ['tablet', 'capsule', 'extended-release'], commonDosages: ['120mg', '180mg', '240mg', '360mg'] },
  { name: 'Carvedilol', aliases: ['coreg'], drugClass: 'Beta Blocker', forms: ['tablet'], commonDosages: ['3.125mg', '6.25mg', '12.5mg', '25mg'] },
  { name: 'Simvastatin', aliases: ['zocor'], drugClass: 'Statin', forms: ['tablet'], commonDosages: ['10mg', '20mg', '40mg'] },
  { name: 'Rosuvastatin', aliases: ['crestor'], drugClass: 'Statin', forms: ['tablet'], commonDosages: ['5mg', '10mg', '20mg', '40mg'] },
  { name: 'Pravastatin', aliases: ['pravachol'], drugClass: 'Statin', forms: ['tablet'], commonDosages: ['10mg', '20mg', '40mg', '80mg'] },
  
  // --- Diabetes ---
  { name: 'Metformin', aliases: ['glucophage', 'fortamet'], drugClass: 'Biguanide', forms: ['tablet', 'extended-release'], commonDosages: ['500mg', '850mg', '1000mg'] },
  { name: 'Glipizide', aliases: ['glucotrol'], drugClass: 'Sulfonylurea', forms: ['tablet', 'extended-release'], commonDosages: ['5mg', '10mg'] },
  { name: 'Insulin Glargine', aliases: ['lantus', 'basaglar', 'toujeo'], drugClass: 'Insulin', forms: ['injection'], commonDosages: ['10 units', '20 units', '30 units'] },
  { name: 'Sitagliptin', aliases: ['januvia'], drugClass: 'DPP-4 Inhibitor', forms: ['tablet'], commonDosages: ['25mg', '50mg', '100mg'] },
  { name: 'Empagliflozin', aliases: ['jardiance'], drugClass: 'SGLT2 Inhibitor', forms: ['tablet'], commonDosages: ['10mg', '25mg'] },
  { name: 'Liraglutide', aliases: ['victoza', 'saxenda'], drugClass: 'GLP-1 Agonist', forms: ['injection'], commonDosages: ['0.6mg', '1.2mg', '1.8mg'] },
  { name: 'Glyburide', aliases: ['diabeta', 'micronase'], drugClass: 'Sulfonylurea', forms: ['tablet'], commonDosages: ['1.25mg', '2.5mg', '5mg'] },
  { name: 'Pioglitazone', aliases: ['actos'], drugClass: 'Thiazolidinedione', forms: ['tablet'], commonDosages: ['15mg', '30mg', '45mg'] },
  
  // --- Pain / Anti-inflammatory ---
  { name: 'Acetaminophen', aliases: ['tylenol', 'paracetamol', 'apap'], drugClass: 'Analgesic', forms: ['tablet', 'capsule', 'liquid', 'suppository'], commonDosages: ['325mg', '500mg', '650mg', '1000mg'] },
  { name: 'Ibuprofen', aliases: ['advil', 'motrin'], drugClass: 'NSAID', forms: ['tablet', 'capsule', 'liquid'], commonDosages: ['200mg', '400mg', '600mg', '800mg'] },
  { name: 'Naproxen', aliases: ['aleve', 'naprosyn'], drugClass: 'NSAID', forms: ['tablet', 'capsule'], commonDosages: ['220mg', '250mg', '375mg', '500mg'] },
  { name: 'Meloxicam', aliases: ['mobic'], drugClass: 'NSAID', forms: ['tablet', 'capsule'], commonDosages: ['7.5mg', '15mg'] },
  { name: 'Tramadol', aliases: ['ultram'], drugClass: 'Opioid Analgesic', forms: ['tablet', 'capsule'], commonDosages: ['50mg', '100mg'] },
  { name: 'Gabapentin', aliases: ['neurontin', 'gralise'], drugClass: 'Anticonvulsant/Neuropathic', forms: ['capsule', 'tablet', 'liquid'], commonDosages: ['100mg', '300mg', '400mg', '600mg', '800mg'] },
  { name: 'Pregabalin', aliases: ['lyrica'], drugClass: 'Anticonvulsant/Neuropathic', forms: ['capsule'], commonDosages: ['25mg', '50mg', '75mg', '150mg', '300mg'] },
  { name: 'Celecoxib', aliases: ['celebrex'], drugClass: 'COX-2 Inhibitor', forms: ['capsule'], commonDosages: ['100mg', '200mg'] },
  { name: 'Diclofenac', aliases: ['voltaren', 'cataflam'], drugClass: 'NSAID', forms: ['tablet', 'gel', 'patch'], commonDosages: ['25mg', '50mg', '75mg'] },
  
  // --- Mental Health ---
  { name: 'Sertraline', aliases: ['zoloft'], drugClass: 'SSRI', forms: ['tablet', 'liquid'], commonDosages: ['25mg', '50mg', '100mg', '150mg', '200mg'] },
  { name: 'Escitalopram', aliases: ['lexapro'], drugClass: 'SSRI', forms: ['tablet', 'liquid'], commonDosages: ['5mg', '10mg', '20mg'] },
  { name: 'Fluoxetine', aliases: ['prozac', 'sarafem'], drugClass: 'SSRI', forms: ['capsule', 'tablet', 'liquid'], commonDosages: ['10mg', '20mg', '40mg', '60mg'] },
  { name: 'Citalopram', aliases: ['celexa'], drugClass: 'SSRI', forms: ['tablet', 'liquid'], commonDosages: ['10mg', '20mg', '40mg'] },
  { name: 'Duloxetine', aliases: ['cymbalta'], drugClass: 'SNRI', forms: ['capsule'], commonDosages: ['20mg', '30mg', '60mg'] },
  { name: 'Venlafaxine', aliases: ['effexor'], drugClass: 'SNRI', forms: ['tablet', 'capsule', 'extended-release'], commonDosages: ['37.5mg', '75mg', '150mg', '225mg'] },
  { name: 'Bupropion', aliases: ['wellbutrin', 'zyban'], drugClass: 'NDRI', forms: ['tablet', 'extended-release'], commonDosages: ['75mg', '100mg', '150mg', '300mg'] },
  { name: 'Trazodone', aliases: ['desyrel', 'oleptro'], drugClass: 'SARI', forms: ['tablet'], commonDosages: ['50mg', '100mg', '150mg', '300mg'] },
  { name: 'Mirtazapine', aliases: ['remeron'], drugClass: 'NaSSA', forms: ['tablet'], commonDosages: ['7.5mg', '15mg', '30mg', '45mg'] },
  { name: 'Amitriptyline', aliases: ['elavil'], drugClass: 'TCA', forms: ['tablet'], commonDosages: ['10mg', '25mg', '50mg', '75mg', '100mg'] },
  { name: 'Alprazolam', aliases: ['xanax'], drugClass: 'Benzodiazepine', forms: ['tablet'], commonDosages: ['0.25mg', '0.5mg', '1mg', '2mg'] },
  { name: 'Lorazepam', aliases: ['ativan'], drugClass: 'Benzodiazepine', forms: ['tablet', 'injection'], commonDosages: ['0.5mg', '1mg', '2mg'] },
  { name: 'Diazepam', aliases: ['valium'], drugClass: 'Benzodiazepine', forms: ['tablet', 'injection', 'rectal gel'], commonDosages: ['2mg', '5mg', '10mg'] },
  { name: 'Quetiapine', aliases: ['seroquel'], drugClass: 'Atypical Antipsychotic', forms: ['tablet', 'extended-release'], commonDosages: ['25mg', '50mg', '100mg', '200mg', '300mg', '400mg'] },
  { name: 'Aripiprazole', aliases: ['abilify'], drugClass: 'Atypical Antipsychotic', forms: ['tablet', 'liquid', 'injection'], commonDosages: ['2mg', '5mg', '10mg', '15mg', '20mg', '30mg'] },
  { name: 'Risperidone', aliases: ['risperdal'], drugClass: 'Atypical Antipsychotic', forms: ['tablet', 'liquid', 'injection'], commonDosages: ['0.5mg', '1mg', '2mg', '3mg', '4mg'] },
  { name: 'Buspirone', aliases: ['buspar'], drugClass: 'Anxiolytic', forms: ['tablet'], commonDosages: ['5mg', '10mg', '15mg', '30mg'] },
  { name: 'Hydroxyzine', aliases: ['vistaril', 'atarax'], drugClass: 'Antihistamine/Anxiolytic', forms: ['tablet', 'capsule', 'liquid'], commonDosages: ['10mg', '25mg', '50mg'] },
  
  // --- Respiratory ---
  { name: 'Albuterol', aliases: ['proventil', 'ventolin', 'proair', 'salbutamol'], drugClass: 'Beta-2 Agonist', forms: ['inhaler', 'nebulizer solution', 'tablet'], commonDosages: ['90mcg/actuation', '2mg', '4mg'] },
  { name: 'Fluticasone', aliases: ['flonase', 'flovent'], drugClass: 'Corticosteroid', forms: ['inhaler', 'nasal spray'], commonDosages: ['44mcg', '110mcg', '220mcg', '50mcg/spray'] },
  { name: 'Montelukast', aliases: ['singulair'], drugClass: 'Leukotriene Modifier', forms: ['tablet', 'chewable tablet', 'granules'], commonDosages: ['4mg', '5mg', '10mg'] },
  { name: 'Tiotropium', aliases: ['spiriva'], drugClass: 'Anticholinergic', forms: ['inhaler'], commonDosages: ['18mcg', '2.5mcg'] },
  { name: 'Prednisone', aliases: ['deltasone', 'rayos'], drugClass: 'Corticosteroid', forms: ['tablet', 'liquid'], commonDosages: ['5mg', '10mg', '20mg', '50mg'] },
  { name: 'Cetirizine', aliases: ['zyrtec'], drugClass: 'Antihistamine', forms: ['tablet', 'liquid'], commonDosages: ['5mg', '10mg'] },
  { name: 'Loratadine', aliases: ['claritin'], drugClass: 'Antihistamine', forms: ['tablet', 'liquid'], commonDosages: ['10mg'] },
  { name: 'Fexofenadine', aliases: ['allegra'], drugClass: 'Antihistamine', forms: ['tablet'], commonDosages: ['60mg', '180mg'] },
  
  // --- GI ---
  { name: 'Omeprazole', aliases: ['prilosec'], drugClass: 'PPI', forms: ['capsule', 'tablet'], commonDosages: ['10mg', '20mg', '40mg'] },
  { name: 'Pantoprazole', aliases: ['protonix'], drugClass: 'PPI', forms: ['tablet', 'injection'], commonDosages: ['20mg', '40mg'] },
  { name: 'Esomeprazole', aliases: ['nexium'], drugClass: 'PPI', forms: ['capsule', 'packet'], commonDosages: ['20mg', '40mg'] },
  { name: 'Ranitidine', aliases: ['zantac'], drugClass: 'H2 Blocker', forms: ['tablet', 'liquid'], commonDosages: ['75mg', '150mg', '300mg'] },
  { name: 'Famotidine', aliases: ['pepcid'], drugClass: 'H2 Blocker', forms: ['tablet', 'liquid', 'injection'], commonDosages: ['10mg', '20mg', '40mg'] },
  { name: 'Ondansetron', aliases: ['zofran'], drugClass: 'Antiemetic', forms: ['tablet', 'ODT', 'injection', 'liquid'], commonDosages: ['4mg', '8mg'] },
  { name: 'Loperamide', aliases: ['imodium'], drugClass: 'Antidiarrheal', forms: ['capsule', 'tablet', 'liquid'], commonDosages: ['2mg'] },
  { name: 'Docusate', aliases: ['colace'], drugClass: 'Stool Softener', forms: ['capsule', 'liquid'], commonDosages: ['100mg', '250mg'] },
  
  // --- Antibiotics ---
  { name: 'Amoxicillin', aliases: ['amoxil', 'trimox'], drugClass: 'Penicillin', forms: ['capsule', 'tablet', 'liquid'], commonDosages: ['250mg', '500mg', '875mg'] },
  { name: 'Azithromycin', aliases: ['zithromax', 'z-pack', 'zpack'], drugClass: 'Macrolide', forms: ['tablet', 'liquid', 'injection'], commonDosages: ['250mg', '500mg'] },
  { name: 'Ciprofloxacin', aliases: ['cipro'], drugClass: 'Fluoroquinolone', forms: ['tablet', 'liquid', 'injection'], commonDosages: ['250mg', '500mg', '750mg'] },
  { name: 'Levofloxacin', aliases: ['levaquin'], drugClass: 'Fluoroquinolone', forms: ['tablet', 'liquid', 'injection'], commonDosages: ['250mg', '500mg', '750mg'] },
  { name: 'Doxycycline', aliases: ['vibramycin', 'doryx'], drugClass: 'Tetracycline', forms: ['capsule', 'tablet'], commonDosages: ['50mg', '100mg'] },
  { name: 'Metronidazole', aliases: ['flagyl'], drugClass: 'Nitroimidazole', forms: ['tablet', 'capsule', 'injection', 'gel'], commonDosages: ['250mg', '500mg'] },
  { name: 'Cephalexin', aliases: ['keflex'], drugClass: 'Cephalosporin', forms: ['capsule', 'tablet', 'liquid'], commonDosages: ['250mg', '500mg'] },
  { name: 'Sulfamethoxazole-Trimethoprim', aliases: ['bactrim', 'septra', 'smz-tmp'], drugClass: 'Sulfonamide', forms: ['tablet', 'liquid'], commonDosages: ['400mg/80mg', '800mg/160mg'] },
  { name: 'Nitrofurantoin', aliases: ['macrobid', 'macrodantin'], drugClass: 'Nitrofuran', forms: ['capsule'], commonDosages: ['50mg', '100mg'] },
  { name: 'Clindamycin', aliases: ['cleocin'], drugClass: 'Lincosamide', forms: ['capsule', 'liquid', 'injection', 'topical'], commonDosages: ['150mg', '300mg'] },
  
  // --- Thyroid ---
  { name: 'Levothyroxine', aliases: ['synthroid', 'levoxyl', 'tirosint'], drugClass: 'Thyroid Hormone', forms: ['tablet', 'capsule', 'liquid'], commonDosages: ['25mcg', '50mcg', '75mcg', '88mcg', '100mcg', '112mcg', '125mcg', '137mcg', '150mcg', '175mcg', '200mcg'] },
  
  // --- Supplements / Vitamins ---
  { name: 'Vitamin D', aliases: ['cholecalciferol', 'ergocalciferol', 'vitamin d3', 'vitamin d2'], drugClass: 'Vitamin', forms: ['tablet', 'capsule', 'liquid'], commonDosages: ['400IU', '1000IU', '2000IU', '5000IU', '50000IU'] },
  { name: 'Calcium Carbonate', aliases: ['tums', 'caltrate', 'os-cal'], drugClass: 'Mineral Supplement', forms: ['tablet', 'chewable'], commonDosages: ['500mg', '600mg', '1000mg', '1250mg'] },
  { name: 'Ferrous Sulfate', aliases: ['feosol', 'iron supplement'], drugClass: 'Iron Supplement', forms: ['tablet', 'liquid'], commonDosages: ['325mg'] },
  { name: 'Potassium Chloride', aliases: ['k-dur', 'klor-con', 'micro-k'], drugClass: 'Electrolyte', forms: ['tablet', 'capsule', 'liquid', 'extended-release'], commonDosages: ['10mEq', '20mEq'] },
  { name: 'Folic Acid', aliases: ['folate'], drugClass: 'Vitamin', forms: ['tablet'], commonDosages: ['400mcg', '800mcg', '1mg'] },
  
  // --- Sleep ---
  { name: 'Zolpidem', aliases: ['ambien'], drugClass: 'Sedative-Hypnotic', forms: ['tablet', 'extended-release'], commonDosages: ['5mg', '10mg'] },
  { name: 'Melatonin', aliases: [], drugClass: 'Supplement', forms: ['tablet', 'gummy', 'liquid'], commonDosages: ['1mg', '3mg', '5mg', '10mg'] },
  
  // --- Bone Health ---
  { name: 'Alendronate', aliases: ['fosamax'], drugClass: 'Bisphosphonate', forms: ['tablet', 'liquid'], commonDosages: ['10mg', '35mg', '70mg'] },
  
  // --- Urological ---
  { name: 'Tamsulosin', aliases: ['flomax'], drugClass: 'Alpha Blocker', forms: ['capsule'], commonDosages: ['0.4mg'] },
  { name: 'Finasteride', aliases: ['proscar', 'propecia'], drugClass: '5-Alpha Reductase Inhibitor', forms: ['tablet'], commonDosages: ['1mg', '5mg'] },
  
  // --- Seizure ---
  { name: 'Levetiracetam', aliases: ['keppra'], drugClass: 'Anticonvulsant', forms: ['tablet', 'liquid', 'injection'], commonDosages: ['250mg', '500mg', '750mg', '1000mg'] },
  { name: 'Lamotrigine', aliases: ['lamictal'], drugClass: 'Anticonvulsant', forms: ['tablet', 'chewable', 'extended-release'], commonDosages: ['25mg', '100mg', '150mg', '200mg'] },
  { name: 'Topiramate', aliases: ['topamax'], drugClass: 'Anticonvulsant', forms: ['tablet', 'capsule'], commonDosages: ['25mg', '50mg', '100mg', '200mg'] },
  { name: 'Phenytoin', aliases: ['dilantin'], drugClass: 'Anticonvulsant', forms: ['capsule', 'liquid', 'injection'], commonDosages: ['100mg', '200mg', '300mg'] },
  { name: 'Valproic Acid', aliases: ['depakote', 'depakene'], drugClass: 'Anticonvulsant', forms: ['tablet', 'capsule', 'liquid', 'injection'], commonDosages: ['250mg', '500mg'] },
];

/**
 * Common prescription abbreviation mappings.
 */
export const PRESCRIPTION_ABBREVIATIONS: Record<string, string> = {
  // Frequency
  'qd': 'once daily',
  'od': 'once daily',
  'bid': 'twice daily',
  'tid': 'three times daily',
  'qid': 'four times daily',
  'q4h': 'every 4 hours',
  'q6h': 'every 6 hours',
  'q8h': 'every 8 hours',
  'q12h': 'every 12 hours',
  'prn': 'as needed',
  'hs': 'at bedtime',
  'qhs': 'at bedtime',
  'ac': 'before meals',
  'pc': 'after meals',
  'stat': 'immediately',
  'qam': 'every morning',
  'qpm': 'every evening',
  'qwk': 'once weekly',
  'biw': 'twice weekly',
  
  // Route
  'po': 'by mouth',
  'sl': 'sublingual',
  'im': 'intramuscular',
  'iv': 'intravenous',
  'sc': 'subcutaneous',
  'sq': 'subcutaneous',
  'pr': 'rectally',
  'inh': 'inhaled',
  'top': 'topically',
  'od (eye)': 'right eye',
  'os': 'left eye',
  'ou': 'both eyes',
  'ad': 'right ear',
  'as (ear)': 'left ear',
  'au': 'both ears',
  
  // Form
  'tab': 'tablet',
  'tabs': 'tablets',
  'cap': 'capsule',
  'caps': 'capsules',
  'susp': 'suspension',
  'sol': 'solution',
  'inj': 'injection',
  'cr': 'controlled-release',
  'er': 'extended-release',
  'sr': 'sustained-release',
  'xl': 'extended-release',
  'xr': 'extended-release',
  'dr': 'delayed-release',
  'ec': 'enteric-coated',
  'odt': 'orally disintegrating tablet',
  
  // Quantity
  'i': '1',
  'ii': '2',
  'iii': '3',
  'ss': '0.5',
};

/**
 * Compute Levenshtein distance between two strings for fuzzy matching.
 */
export function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
}

/**
 * Find the best matching drug from the dictionary for a given OCR input.
 * Returns null if no reasonable match is found.
 */
export function findDrugMatch(
  input: string,
  maxDistance: number = 3
): { drug: DrugEntry; confidence: number; exact: boolean } | null {
  const normalizedInput = input.toLowerCase().trim();
  if (normalizedInput.length < 3) return null;

  let bestMatch: DrugEntry | null = null;
  let bestDistance = Infinity;

  for (const drug of DRUG_DATABASE) {
    // Check primary name
    const nameDistance = levenshteinDistance(normalizedInput, drug.name.toLowerCase());
    if (nameDistance < bestDistance) {
      bestDistance = nameDistance;
      bestMatch = drug;
    }

    // Check aliases
    for (const alias of drug.aliases) {
      const aliasDistance = levenshteinDistance(normalizedInput, alias.toLowerCase());
      if (aliasDistance < bestDistance) {
        bestDistance = aliasDistance;
        bestMatch = drug;
      }
    }

    // Early exit on exact match
    if (bestDistance === 0) break;
  }

  if (bestMatch && bestDistance <= maxDistance) {
    // Confidence decreases with edit distance
    const maxLen = Math.max(normalizedInput.length, bestMatch.name.length);
    const confidence = Math.max(0, 1 - bestDistance / maxLen);
    return { drug: bestMatch, confidence, exact: bestDistance === 0 };
  }

  return null;
}

/**
 * Expand a prescription abbreviation to its full-text meaning.
 */
export function expandAbbreviation(abbrev: string): string {
  const normalized = abbrev.toLowerCase().trim();
  return PRESCRIPTION_ABBREVIATIONS[normalized] || abbrev;
}
