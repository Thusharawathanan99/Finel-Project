import React,{useCallback,useEffect,useRef,useState} from 'react';
import {ActivityIndicator,AppState,Linking,Text,TextInput,TouchableOpacity,View} from 'react-native';
import {apiFetch} from '../apiHelper';

export default function MonitoringIncidents({residents=[]}){
  const [rows,setRows]=useState([]),[error,setError]=useState(''),[selected,setSelected]=useState(null),[notes,setNotes]=useState(''),[saving,setSaving]=useState(false);
  const [loading,setLoading]=useState(true),[history,setHistory]=useState([]),[choices,setChoices]=useState([]),[correctedResident,setCorrectedResident]=useState(''),[detailLoading,setDetailLoading]=useState(false),[detailError,setDetailError]=useState('');
  const epoch=useRef(0),alive=useRef(false),busy=useRef(false),controller=useRef(null),reading=useRef(false);
  const detailEpoch=useRef(0),detailController=useRef(null),actionController=useRef(null);
  const load=useCallback(async()=>{
    if(!alive.current||reading.current||AppState.currentState!=='active')return;
    const run=epoch.current;const abort=new AbortController();controller.current=abort;reading.current=true;
    const timeout=setTimeout(()=>abort.abort(),10_000);
    try{const response=await apiFetch('/monitoring/incidents',{signal:abort.signal});const data=await response.json();if(!response.ok||!Array.isArray(data))throw Error(data.error||'Monitoring incidents could not be updated.');if(alive.current&&run===epoch.current){setRows(data);setError('');}}
    catch(e){if(alive.current&&run===epoch.current)setError(e.name==='AbortError'?'Monitoring update timed out. Tap refresh.':e.message);}
    finally{clearTimeout(timeout);reading.current=false;controller.current=null;if(alive.current&&run===epoch.current)setLoading(false);}
  },[]);
  useEffect(()=>{
    alive.current=true;void load();const timer=setInterval(load,10_000);
    const subscription=AppState.addEventListener('change',state=>{if(state==='active')void load();else{epoch.current++;detailEpoch.current++;controller.current?.abort();detailController.current?.abort();actionController.current?.abort();setSelected(null);setDetailLoading(false);}});
    return()=>{alive.current=false;epoch.current++;detailEpoch.current++;controller.current?.abort();detailController.current?.abort();actionController.current?.abort();clearInterval(timer);subscription.remove();};
  },[load]);
  const review=async(row)=>{
    if(busy.current)return;
    const run=++detailEpoch.current,ownerRun=epoch.current,abort=new AbortController();
    detailController.current?.abort();detailController.current=abort;
    setSelected(row.incident_id);setNotes('');setError('');setHistory([]);setChoices([]);setCorrectedResident('');setDetailError('');setDetailLoading(true);
    const timeout=setTimeout(()=>abort.abort(),10_000);
    const read=async(path)=>{const response=await apiFetch(path,{signal:abort.signal});const data=await response.json();if(!response.ok||!Array.isArray(data))throw Error(data.error||'Incident records could not be loaded.');return data;};
    try{
      const [actions,devices]=await Promise.all([read(`/monitoring/incidents/${row.incident_id}/actions`),read('/monitoring/devices')]);
      if(!alive.current||run!==detailEpoch.current||ownerRun!==epoch.current)return;
      const assigned=devices.find(device=>device.device_id===row.device_id)?.resident_ids||[];
      setHistory(actions);setChoices(residents.filter(resident=>assigned.includes(resident.resident_id||resident.id)));
    }catch(e){if(alive.current&&run===detailEpoch.current&&ownerRun===epoch.current)setDetailError(e.name==='AbortError'?'Incident history timed out. Reopen the incident to retry.':e.message);}
    finally{clearTimeout(timeout);if(run===detailEpoch.current){detailController.current=null;if(alive.current)setDetailLoading(false);}}
  };
  const act=async(action)=>{
    if(busy.current||!selected)return;
    if(['resolved','false_alarm','resident_corrected','note'].includes(action)&&!notes.trim()){setError('Enter the observation and verification reason.');return;}
    if(action==='resident_corrected'&&!correctedResident){setError('Choose the verified resident assigned to this camera.');return;}
    const run=epoch.current,abort=new AbortController();actionController.current=abort;busy.current=true;setSaving(true);setError('');
    const timeout=setTimeout(()=>abort.abort(),10_000);
    try{const response=await apiFetch(`/monitoring/incidents/${selected}/actions`,{method:'POST',signal:abort.signal,body:JSON.stringify({action,notes:notes.trim(),...(action==='resident_corrected'?{residentId:correctedResident}:{})})});const data=await response.json();if(!response.ok)throw Error(data.error||'Incident action could not be saved.');if(alive.current&&run===epoch.current){detailEpoch.current++;detailController.current?.abort();setSelected(null);setNotes('');await load();}}
    catch(e){if(alive.current&&run===epoch.current)setError(e.name==='AbortError'?'The action could not be confirmed. Refresh the incident before retrying.':e.message);}
    finally{clearTimeout(timeout);actionController.current=null;busy.current=false;if(alive.current)setSaving(false);}
  };
  return <View style={{marginTop:16,padding:16,borderRadius:16,backgroundColor:'#FFF',borderColor:'#CBD5E1',borderWidth:1}}>
    <Text style={{fontSize:18,fontWeight:'700'}}>Camera safety incidents</Text>
    <Text style={{fontSize:12,color:'#475569',marginVertical:8}}>Verify observations with the resident. AI activity scores are not a diagnosis.</Text>
    {error?<Text accessibilityRole="alert" style={{color:'#991B1B'}}>{error}</Text>:null}
    <TouchableOpacity onPress={load}><Text style={{color:'#0F766E',paddingVertical:8}}>Refresh incidents</Text></TouchableOpacity>
    {loading?<ActivityIndicator color="#0F766E"/>:!rows.length&&!error?<Text>No open camera incidents.</Text>:null}
    {rows.map(row=><View key={row.incident_id} style={{paddingVertical:12,borderTopWidth:1,borderTopColor:'#E2E8F0'}}>
      <Text style={{fontWeight:'700',color:row.severity==='critical'?'#991B1B':'#92400E'}}>{row.resident_name||'Camera status'} · {row.incident_type.replace(/_/g,' ')}</Text>
      <Text>{row.device_name} {row.location||''}</Text><Text>{row.reason}</Text><Text>{row.recommended_action}</Text>
      {row.confidence!=null?<Text style={{fontSize:12,color:'#475569'}}>AI confidence: {Math.round(Number(row.confidence)*100)}% · verify with the resident</Text>:null}
      {row.acknowledged_by_uid?<Text style={{fontSize:12,color:'#475569'}}>Responsible caretaker: {row.acknowledged_by_name||'Recorded caretaker'}</Text>:null}
      <Text style={{fontSize:12,color:'#475569',marginVertical:4}}>{new Date(row.detected_at).toLocaleString()} · {row.status}{row.response_time_seconds!=null?` · response ${row.response_time_seconds}s`:''}</Text>
      <TouchableOpacity accessibilityRole="button" disabled={saving} onPress={()=>void review(row)}><Text style={{color:'#0F766E',paddingVertical:8}}>Review and record action</Text></TouchableOpacity>
      {selected===row.incident_id?<View>
        <Text style={{fontWeight:'700',marginVertical:6}}>Recorded actions</Text>
        {detailLoading?<ActivityIndicator color="#0F766E"/>:null}
        {detailError?<Text accessibilityRole="alert" style={{color:'#991B1B'}}>{detailError}</Text>:!detailLoading&&!history.length?<Text style={{color:'#475569'}}>No actions recorded yet.</Text>:null}
        {history.map(item=><View key={item.action_id} style={{marginBottom:8}}><Text>{String(item.action).replace(/_/g,' ')} · {new Date(item.created_at).toLocaleString()}</Text>{item.actor_uid?<Text style={{fontSize:12,color:'#475569'}}>Recorded by: {item.actor_name||'Recorded caretaker'}</Text>:null}{item.notes?<Text style={{color:'#475569'}}>{item.notes}</Text>:null}</View>)}
        <TextInput multiline maxLength={2000} editable={!saving} placeholder="Observation and verification reason" value={notes} onChangeText={setNotes} style={{borderWidth:1,borderColor:'#CBD5E1',padding:10,minHeight:70,borderRadius:8}}/>
        {[['acknowledged','Acknowledge'],['false_alarm','False alarm'],['emergency_contacted','Emergency contact already made'],['resolved','Resident checked — resolve'],['note','Save observation']].map(([action,label])=><TouchableOpacity key={action} disabled={saving} onPress={()=>void act(action)}><Text style={{paddingVertical:9,color:'#0F766E'}}>{label}</Text></TouchableOpacity>)}
        {choices.length?<View><Text style={{fontWeight:'700',marginTop:10}}>Correct the resident after verification</Text>{choices.map(resident=>{const id=resident.resident_id||resident.id;return <TouchableOpacity accessibilityRole="radio" accessibilityState={{checked:correctedResident===id}} key={id} disabled={saving} onPress={()=>setCorrectedResident(id)}><Text style={{paddingVertical:9,color:'#0F766E'}}>{correctedResident===id?'●':'○'} {resident.name}</Text></TouchableOpacity>;})}<TouchableOpacity accessibilityRole="button" disabled={saving||!correctedResident} onPress={()=>void act('resident_corrected')}><Text style={{color:'#0F766E',paddingVertical:9}}>Save verified resident correction</Text></TouchableOpacity></View>:null}
        <TouchableOpacity accessibilityRole="button" onPress={()=>void Linking.openURL('tel:1990').catch(()=>setError('Open your phone dialer and call 1990.'))}><Text style={{color:'#991B1B',paddingVertical:9}}>Call 1990</Text></TouchableOpacity>
        <Text style={{fontSize:12,color:'#475569'}}>Record emergency contact only after making the call yourself.</Text>
        <TouchableOpacity accessibilityRole="button" disabled={saving} onPress={()=>{detailEpoch.current++;detailController.current?.abort();setSelected(null);}}><Text style={{paddingVertical:9,color:'#475569'}}>Close review</Text></TouchableOpacity>
      </View>:null}
    </View>)}
  </View>;
}
