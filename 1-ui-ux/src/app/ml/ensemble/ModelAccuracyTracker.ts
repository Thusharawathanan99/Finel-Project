import type { ModelSource, EnsembleMedication } from './EnsembleOrchestrator';
import type { CandidateSourceEvidence } from '../../../../../4-system-engine/api/routes/prescriptionSafety.js';
export interface ModelMetrics {
  totalPredictions:number; correctPredictions:number; accuracy:number;
  totalMedicationsFound:number; averageConfidence:number; lastUpdated:string;
}
export interface AccuracySnapshot {
  donut:ModelMetrics; regex:ModelMetrics; gemini:ModelMetrics; ensemble:ModelMetrics;
  totalPrescriptions:number; modelAgreementRate:number; lastUpdated:string;
}
type Regimen = {drugName:string; dosage:string; frequency?:string; duration?:string; instructions?:string};
interface PredictionRecord {
  id:string; timestamp:string; medications:(Regimen & {sources:ModelSource[];confidence:number;
    sourceDetails?:Partial<Record<ModelSource,CandidateSourceEvidence>>})[];
  wasConfirmed:boolean; wasCorrected:boolean; correctMedications?:Regimen[];
  invokedSources:ModelSource[];
}
const sources = ['donut','regex','gemini','ensemble'] as const;
const normalize = (value:unknown) => String(value||'').toLowerCase().replace(/\s+/g,'');
const equal = (left:Regimen,right:Regimen) => ['drugName','dosage','frequency','duration','instructions']
  .every(field=>normalize(left[field as keyof Regimen])===normalize(right[field as keyof Regimen]));
const clean = (item:Regimen):Regimen => ({drugName:item.drugName,dosage:item.dosage,
  frequency:item.frequency||'',duration:item.duration||'',instructions:item.instructions||''});
class ModelAccuracyTracker {
  private predictions:PredictionRecord[]=[];
  private scope:string|null=null;
  private scopeGeneration=0;
  getScopeToken():number { return this.scopeGeneration; }
  private baseline=this.defaults();
  private metrics=this.defaults();
  private get key(){return this.scope?'careconnect_accuracy_v3:'+encodeURIComponent(this.scope):null;}
  private defaults():AccuracySnapshot {
    const model=()=>({totalPredictions:0,correctPredictions:0,accuracy:0,totalMedicationsFound:0,
      averageConfidence:0,lastUpdated:new Date().toISOString()});
    return {donut:model(),regex:model(),gemini:model(),ensemble:model(),totalPrescriptions:0,
      modelAgreementRate:0,lastUpdated:new Date().toISOString()};
  }
  setScope(uid:string|null):void {
    if(uid===this.scope)return;
    this.scopeGeneration++;
    this.scope=uid;this.predictions=[];this.baseline=this.defaults();
    try {
      localStorage.removeItem('careconnect_model_accuracy');
      const data=this.key?JSON.parse(localStorage.getItem(this.key)||'null'):null;
      if(data && sources.every(source=>Number.isFinite(data[source]?.totalPredictions)
        && Number.isFinite(data[source]?.correctPredictions) && data[source].totalPredictions>=0
        && data[source].correctPredictions>=0 && data[source].correctPredictions<=data[source].totalPredictions)){
        this.baseline=data;
      }
    }catch{/* Optional aggregate storage only. */}
    this.recalculate();
  }
  recordPrediction(items:EnsembleMedication[],scopeToken=this.scopeGeneration,invokedSources?:ModelSource[]):string {
    if(scopeToken!==this.scopeGeneration)return '';
    const id='pred-'+Date.now()+'-'+Math.random().toString(36).slice(2,10);
    this.predictions.push({id,timestamp:new Date().toISOString(),wasConfirmed:false,wasCorrected:false,
      invokedSources:invokedSources || [...new Set(items.flatMap(item=>item.sources))],
      medications:items.map(item=>({...clean(item.medication),sources:[...item.sources],
        confidence:item.confidence,sourceDetails:JSON.parse(JSON.stringify(item.sourceDetails||{}))}))});
    this.recalculate();return id;
  }
  confirmPrediction(id:string):void {
    const record=this.predictions.find(item=>item.id===id);
    if(!record||record.wasConfirmed)return;
    record.wasConfirmed=true;record.correctMedications=record.medications.map(clean);
    this.recalculate();
  }
  recordCorrection(id:string,truth:Regimen[]):void {
    const record=this.predictions.find(item=>item.id===id);
    if(!record)return;
    record.wasConfirmed=true;record.correctMedications=truth.map(clean);
    record.wasCorrected=record.medications.length!==truth.length ||
      record.medications.some((med,index)=>!truth[index]||!equal(med,truth[index]));
    this.recalculate();
  }
  private recalculate():void {
    const metrics=JSON.parse(JSON.stringify(this.baseline)) as AccuracySnapshot;
    metrics.totalPrescriptions+=this.predictions.length;
    for(const record of this.predictions){
      for(const source of sources){
        if(source!=='ensemble' && !record.invokedSources.includes(source))continue;
        const candidates:Regimen[] = source==='ensemble'?record.medications:record.medications.flatMap(med=>{
          if(!med.sources.includes(source))return[];
          return med.sourceDetails?.[source]?.candidates?.length
            ? med.sourceDetails[source]!.candidates.map(clean) : [clean(med)];
        });
        const target=metrics[source];
        const previous=target.totalMedicationsFound;
        target.totalMedicationsFound+=candidates.length;
        const confidenceValues=source==='ensemble' ? record.medications.map(med=>med.confidence) : record.medications.filter(med=>med.sources.includes(source)).flatMap(med=>{
          const evidence=med.sourceDetails?.[source];
          return evidence?.candidates?.length ? evidence.candidates.map(candidate=>Number.isFinite(candidate.confidence)?candidate.confidence:evidence.confidence) : [evidence?.confidence ?? med.confidence];
        });
        const confidence=confidenceValues.length ? confidenceValues.reduce((sum,value)=>sum+(Number.isFinite(value)?value:0),0)/confidenceValues.length : 0;
        if(target.totalMedicationsFound)target.averageConfidence=
          (target.averageConfidence*previous+confidence*candidates.length)/target.totalMedicationsFound;
        if(record.wasConfirmed && record.correctMedications){
          const available=[...record.correctMedications];
          let correct=0;
          for(const candidate of candidates){
            const index=available.findIndex(truth=>equal(candidate,truth));
            if(index>=0){correct++;available.splice(index,1);}
          }
          target.totalPredictions+=Math.max(candidates.length,record.correctMedications.length);
          target.correctPredictions+=correct;
        }
      }
    }
    const baseCount=this.baseline.totalPrescriptions;
    const agreement=this.predictions.reduce((sum,record)=>sum+(record.medications.length
      ? record.medications.reduce((total,med)=>total+med.sources.length/3,0)/record.medications.length : 0),0);
    metrics.modelAgreementRate=metrics.totalPrescriptions
      ? (this.baseline.modelAgreementRate*baseCount+agreement)/metrics.totalPrescriptions : 0;
    for(const source of sources){
      metrics[source].accuracy=metrics[source].totalPredictions
        ? Math.min(1,metrics[source].correctPredictions/metrics[source].totalPredictions):0;
      metrics[source].lastUpdated=new Date().toISOString();
    }
    metrics.lastUpdated=new Date().toISOString();this.metrics=metrics;
    // Never persist raw medication histories or prescription text for metrics.
    try {if(this.key)localStorage.setItem(this.key,JSON.stringify(metrics));}catch{/* Storage unavailable. */}
  }
  getMetrics():AccuracySnapshot{return JSON.parse(JSON.stringify(this.metrics));}
  getModelMetrics(source:ModelSource):ModelMetrics{return {...this.metrics[source]};}
  getRecentPredictions(count=10):PredictionRecord[]{return this.predictions.slice(-count).reverse();}
  getTotalPrescriptions():number{return this.metrics.totalPrescriptions;}
  exportMetrics():string{return JSON.stringify({exportedAt:new Date().toISOString(),metrics:this.metrics},null,2);}
  reset():void{this.predictions=[];this.baseline=this.defaults();this.recalculate();}
}
export const modelAccuracyTracker=new ModelAccuracyTracker();
