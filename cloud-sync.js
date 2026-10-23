/* Supabase REST client. Only the public publishable key is shipped to browsers. */
(function(root){
  'use strict';
  const URL='https://vybgmqjilhfsythiutnw.supabase.co';
  const KEY='sb_publishable_EkHnRRZbyvFG2gvhyMyZjA_ek9aJWUD';
  const SESSION='metajhim_cloud_session_v1',META='metajhim_cloud_base_v1',BACKUP='metajhim_cloud_backup_v1';
  const copy=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
  const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  const canonical=v=>v===undefined?'undefined':JSON.stringify(v,(_,value)=>object(value)?Object.fromEntries(Object.keys(value).sort().map(k=>[k,value[k]])):value);
  const equal=(a,b)=>canonical(a)===canonical(b);
  function merge(base,local,remote,path='',conflicts=[],preferRemote=false){
    if(equal(local,base))return {value:copy(remote),conflicts};
    if(equal(remote,base)||equal(local,remote))return {value:copy(local),conflicts};
    if(path.endsWith('.updatedAt')&&typeof local==='string'&&typeof remote==='string'&&Number.isFinite(Date.parse(local))&&Number.isFinite(Date.parse(remote)))return {value:Date.parse(local)>Date.parse(remote)?local:remote,conflicts};
    if(object(local)&&object(remote)&&(base===undefined||object(base))){
      const result=Object.create(null);
      for(const k of new Set([...Object.keys(base||{}),...Object.keys(local),...Object.keys(remote)])){
        const next=merge(base?.[k],local[k],remote[k],path?path+'.'+k:k,conflicts,preferRemote).value;
        if(next!==undefined)result[k]=next;
      }
      return {value:result,conflicts};
    }
    conflicts.push(path||'дневник');return {value:copy(preferRemote?remote:local),conflicts};
  }
  let adapter,session=null,base,revision=0,running=false,timer,refreshing,pending=null,generation=0,currentSync=null,manualBusy=false;
  const $=id=>document.getElementById(id);
  function status(text){$('cloudStatus').textContent=text;}
  function capture(){const data=copy(adapter.read());delete data.activeWeek;return data;}
  function load(key){try{return JSON.parse(localStorage.getItem(key));}catch{return null;}}
  function store(key,value){localStorage.setItem(key,JSON.stringify(value));}
  function persistBase(data,rev){base=copy(data);revision=rev;store(META,{user:session.user.id,data:base,revision});}
  function remember(local,remote){store(BACKUP,{savedAt:new Date().toISOString(),local:copy(local),remote:copy(remote)});}
  function accept(data,options={}){if(!equal(capture(),data)){remember(capture(),data);adapter.apply(copy(data),options);}else if(options.focus)adapter.apply(copy(data),options);}
  function ui(){const signed=!!session;$('cloudLoginForm').hidden=signed;$('cloudAccount').hidden=!signed;$('cloudAccountEmail').textContent=session?.user?.email||'';$('cloudOpenButton').textContent='Синхронизировать';$('cloudAccountButton').hidden=!signed;if(!$('cloudBackupButton')){const b=document.createElement('button');b.id='cloudBackupButton';b.type='button';b.className='btn btn-secondary';b.style.marginLeft='8px';b.textContent='Копия до синхронизации';b.onclick=()=>{const saved=load(BACKUP);if(saved?.local)adapter.download({...saved.local,activeWeek:adapter.read().activeWeek,schema:'metajhim.backup.v2'},'metajhim_before_sync.json');};$('cloudAccount').append(b);}}
  function explain(error){if(error.status===401||error.status===403)return 'Нет доступа. Проверьте вход и настройки доступа к таблице.';if(error.code==='PGRST205'||error.code==='42P01')return 'Таблица ещё не настроена. Выполните supabase/setup.sql в SQL Editor.';if(error.code==='invalid_credentials')return 'Неверный email или пароль.';if(error.name==='TypeError'||error.name==='AbortError')return 'Нет связи с облаком. Записи сохранены на устройстве.';return error.message||'Не удалось синхронизировать дневник.';}
  async function request(path,{method='GET',body,token}={}){
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
    try{
      const response=await fetch(URL+path,{method,signal:controller.signal,cache:'no-store',headers:{apikey:KEY,...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{}),Prefer:'return=representation'},...(body?{body:JSON.stringify(body)}:{})});
      const data=await response.json().catch(()=>null);
      if(!response.ok){const error=Error(data?.msg||data?.error_description||data?.message||'Ошибка облака');error.status=response.status;error.code=data?.error_code||data?.code;throw error;}
      return data;
    }finally{clearTimeout(timeout);}
  }
  function setSession(data){if(!data?.access_token||!data?.refresh_token||!data?.user?.id)throw Error('Некорректный ответ входа.');session={...data,expires_at:data.expires_at||Math.floor(Date.now()/1000)+(data.expires_in||3600)};store(SESSION,session);ui();}
  async function token(){
    if(!session)throw Error('Войдите в аккаунт.');
    if(session.expires_at*1000>Date.now()+60000)return session.access_token;
    if(!refreshing){const current=session.refresh_token,epoch=generation;refreshing=request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:current}}).then(data=>{if(epoch!==generation)throw Error('Вход изменился.');setSession(data);return data.access_token;}).finally(()=>{refreshing=null;});}
    return refreshing;
  }
  function conflict(remote,first=false){remember(capture(),remote.data);pending={remote,first};status(first?'Выберите данные для первой синхронизации':'Есть изменения на двух устройствах — нужен выбор');$('cloudConflict').hidden=false;$('cloudConflictText').textContent=first?'На этом устройстве и в облаке разные дневники. Выберите, какой использовать. Перед заменой обе версии сохранятся в резервной копии.':'Одна и та же запись изменена на двух устройствах. Автоматическая замена остановлена. Выберите нужную версию; обе версии можно скачать.';}
  async function write(data,remote,t){
    if(!remote){try{const rows=await request('/rest/v1/diary_state',{method:'POST',token:t,body:{user_id:session.user.id,data,revision:1,updated_at:new Date().toISOString()}});return rows?.[0]||null;}catch(e){if(e.status===409)return null;throw e;}}
    const rows=await request('/rest/v1/diary_state?user_id=eq.'+encodeURIComponent(session.user.id)+'&revision=eq.'+remote.revision,{method:'PATCH',token:t,body:{data,revision:remote.revision+1,updated_at:new Date().toISOString()}});return rows?.[0]||null;
  }
  function sync(options={}){if(currentSync)return currentSync;currentSync=runSync(options).finally(()=>{currentSync=null;});return currentSync;}
  async function runSync({manual=false}={}){
    if(!adapter||!session||running||(pending&&!manual))return;
    if(manual){pending=null;$('cloudConflict').hidden=true;}
    running=true;const epoch=generation;status('Синхронизация…');
    try{
      const t=await token();
      for(let attempt=0;attempt<3;attempt++){
        const rows=await request('/rest/v1/diary_state?user_id=eq.'+encodeURIComponent(session.user.id)+'&select=data,revision',{token:t});
        if(epoch!==generation)return;
        const remote=rows?.[0]||null,local=capture();if(remote)adapter.validate(remote.data);
        if(remote&&base===undefined&&!equal(local,remote.data)&&!manual){conflict(remote,true);return;}
        const result=remote?(base===undefined&&manual?{value:copy(remote.data),conflicts:[]}:merge(base,local,remote.data,'',[],manual)):{value:local,conflicts:[]};
        if(result.conflicts.length&&!manual){conflict(remote);return;}
        if(result.conflicts.length)remember(local,remote.data);
        let saved=remote;
        if(!remote||!equal(result.value,remote.data)){saved=await write(result.value,remote,t);if(!saved)continue;}
        if(epoch!==generation)return;
        const rebased=merge(local,capture(),saved.data);if(rebased.conflicts.length){conflict(saved);return;}
        accept(rebased.value,{focus:manual});persistBase(saved.data,saved.revision);status('Синхронизировано · '+new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})+(manual?' · неделя '+adapter.read().activeWeek:''));
        if(!equal(rebased.value,saved.data))changed();return;
      }
      throw Error('Облако изменилось во время сохранения. Повторите синхронизацию.');
    }catch(error){status(explain(error));}finally{running=false;}
  }
  async function manualSync(){
    if(!session){open();return;}if(manualBusy)return;manualBusy=true;clearTimeout(timer);
    const button=$('cloudOpenButton');button.disabled=true;button.textContent='Синхронизация…';
    try{if(currentSync)await currentSync;await sync({manual:true});}finally{manualBusy=false;button.disabled=false;button.textContent='Синхронизировать';}
  }
  function changed(){if(!session||pending)return;clearTimeout(timer);timer=setTimeout(sync,1200);}
  async function login(event){
    event.preventDefault();$('cloudLoginButton').disabled=true;$('cloudLoginError').textContent='';
    try{const email=$('cloudEmail').value.trim(),password=$('cloudPassword').value;const data=await request('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}});generation++;setSession(data);$('cloudPassword').value='';const previous=load(META);base=previous?.user===session.user.id?previous.data:undefined;revision=previous?.user===session.user.id?previous.revision:0;$('cloudDialog').close();await sync();}
    catch(error){$('cloudLoginError').textContent=explain(error);}finally{$('cloudLoginButton').disabled=false;}
  }
  async function resolve(choice){
    if(!pending||running)return;running=true;const epoch=generation,item=pending;
    try{remember(capture(),item.remote.data);const t=await token();const rows=await request('/rest/v1/diary_state?user_id=eq.'+encodeURIComponent(session.user.id)+'&select=data,revision',{token:t}),latest=rows?.[0];
      if(epoch!==generation)return;if(!latest||latest.revision!==item.remote.revision){pending=null;$('cloudConflict').hidden=true;status('Данные в облаке обновились. Повторите синхронизацию.');return;}
      adapter.validate(latest.data);
      if(choice==='remote'){accept(latest.data);persistBase(latest.data,latest.revision);}
      else{const local=capture(),saved=await write(local,latest,t);if(epoch!==generation)return;if(!saved)throw Error('Данные обновились — повторите выбор.');persistBase(saved.data,saved.revision);}
      pending=null;$('cloudConflict').hidden=true;status('Синхронизировано');changed();
    }catch(e){status(explain(e));}finally{running=false;}
  }
  function downloadBackup(){const data=load(BACKUP);if(data)adapter.download(data,'metajhim_sync_versions.json');}
  function logout(){generation++;clearTimeout(timer);const old=session;session=null;base=undefined;revision=0;pending=null;localStorage.removeItem(SESSION);localStorage.removeItem(META);$('cloudConflict').hidden=true;ui();status('Сохранение на этом устройстве');if(old)request('/auth/v1/logout?scope=local',{method:'POST',token:old.access_token}).catch(()=>{});}
  function open(){ui();$('cloudDialog').showModal();}
  function init(options){adapter=options;session=load(SESSION);if(session&&!session.user?.id)session=null;const previous=load(META);if(session&&previous?.user===session.user.id){base=previous.data;revision=previous.revision;}ui();status(session?'Подключение к облаку…':'Сохранение на этом устройстве');if(session)sync();window.addEventListener('online',sync);document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync();});setInterval(()=>{if(!document.hidden&&!document.activeElement?.matches('input,textarea,select'))sync();},20000);}
  root.MetaJhimCloud={init,changed,sync,manualSync,login,logout,open,resolve,downloadBackup,merge};
})(window);
