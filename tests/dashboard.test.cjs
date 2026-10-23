const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
let documentRequests=0;
new Function(html.split('<script>')[1].split('</script>')[0]);
assert(!html.includes('\uFFFD'), 'UTF-8 replacement character');
const server = http.createServer((req,res) => {
  let file=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(file.startsWith('/metajhim/'))file=file.slice('/metajhim'.length);
  if(file==='/'||file==='/index.html'){documentRequests++;res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
  const asset=path.resolve(root,'.'+file);
  if(!asset.startsWith(root+path.sep)||!fs.existsSync(asset)||!fs.statSync(asset).isFile()){res.writeHead(404);res.end();return;}
  const type={'.js':'application/javascript','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'}[path.extname(asset)]||'text/plain';
  res.setHeader('Content-Type',type);res.end(fs.readFileSync(asset));
});

(async () => {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({headless:true,...(process.env.TEST_BROWSER_CHANNEL?{channel:process.env.TEST_BROWSER_CHANNEL}:{})});
  const errors = [];
  try {
    const context = await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'America/Los_Angeles'});
    const page = await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    await page.clock.install({time:new Date('2026-10-19T12:00:00Z')});
    await page.goto(url);
    assert.equal(await page.locator('#weekSelect option').count(),16);
    assert.equal(await page.locator('#cycleTableBody tr').count(),16);
    assert.equal(await page.locator('.charts svg').count(),2);
    assert.equal(await page.locator('.supp-table input').count(),42);
    assert.equal(await page.locator('#pctDaysCount').innerText(),'1 день');
    assert.equal(await page.locator('.pct-details').getAttribute('open'),null);
    assert.equal(await page.locator('#pctStatusBadge').innerText(),'Через 20 дней');
    assert.equal(await page.locator('#suppDateInput').inputValue(),'2026-10-19');
    assert.equal(await page.evaluate(()=>protectedThrough()),1);
    const dates = [
      ['2026-10-17','before',0,null,-1],['2026-10-18','before',0,null,0],
      ['2026-11-07','before',0,null,20],['2026-11-08','active',1,50,21],
      ['2026-11-14','active',1,50,27],['2026-11-15','active',2,50,28],
      ['2026-11-21','active',2,50,34],['2026-11-22','active',3,25,35],
      ['2026-11-28','active',3,25,41],['2026-11-29','active',4,25,42],
      ['2026-12-05','active',4,25,48],['2026-12-06','after',0,null,49]
    ];
    for(const [date,stage,week,dose,since] of dates){
      const p=await page.evaluate(d=>pctForDate(d),date);
      assert.deepEqual([p.stage,p.week,p.dose,p.daysSince],[stage,week,dose,since],date);
      await page.clock.setSystemTime(new Date(date+'T12:00:00Z'));
      await page.evaluate(()=>updatePctCountdown());
      assert.equal(await page.locator('#pctHeading').innerText(),stage==='before'?'Подготовка к ПКТ':stage==='active'?`ПКТ · неделя ${week} из 4`:'График ПКТ завершён');
      if(stage==='active')assert.equal(await page.locator('#pctNextDate').innerText(),`${dose} мг в день`);
    }
    await page.clock.setSystemTime(new Date('2026-10-19T12:00:00Z'));
    await page.evaluate(()=>updatePctCountdown());
    console.log('PASS: UTF-8, 16 weeks, SVG charts, PCT boundary dates');

    await page.locator('[data-supp-key="2026-10-19_zinc"]').check();
    await page.reload();
    assert.equal(await page.locator('[data-supp-key="2026-10-19_zinc"]').isChecked(),true);
    await page.locator('#suppDateInput').fill('2026-11-23');
    await page.locator('#suppDateInput').dispatchEvent('change');
    await page.locator('[data-supp-key="2026-11-23_clomid"]').check();
    assert.match(await page.locator('[data-supp-key="2026-11-23_clomid"]').locator('..').innerText(),/25 мг/);
    await page.evaluate(()=>shiftSuppWeek(-7));
    assert.equal(await page.locator('[data-supp-key="2026-11-16_clomid"]').isChecked(),false);
    assert.match(await page.locator('[data-supp-key="2026-11-16_clomid"]').locator('..').innerText(),/50 мг/);
    await page.evaluate(()=>shiftSuppWeek(21));
    assert.equal(await page.locator('[data-supp-key="2026-12-07_clomid"]').isDisabled(),true);
    await page.locator('#suppDateInput').fill('2027-01-01');
    await page.locator('#suppDateInput').dispatchEvent('change');
    await page.locator('[data-supp-key="2027-01-01_creatine"]').check();
    assert.match(await page.locator('#suppRange').innerText(),/28\.12\.2026.*03\.01\.2027/);
    console.log('PASS: daily supplement persistence, dose by date, year boundary');

    await page.locator('#factRIR').fill('0');
    await page.locator('#factShoulder').fill('0');
    await page.locator('#factShoulderRight').fill('3');
    const attack='100 кг × 15 " <img src=x onerror="window.injected=true">';
    await page.locator('.legacy-note summary').click();
    await page.locator('#d1FactInput').fill(attack);
    await page.reload();
    assert.equal(await page.locator('#d1FactInput').inputValue(),attack);
    assert.equal(await page.evaluate(()=>window.injected),undefined);
    const payload=await page.evaluate(()=>weeklyPayload());
    assert.equal(payload.fact.rir,0);assert.equal(payload.fact.shoulderLeft,0);assert.equal(payload.fact.shoulderRight,3);
    assert.equal(payload.plan.w,1);assert.equal(payload.suppChecks['2026-10-19_zinc'],true);
    assert(payload.biochemistry.baseline);
    const before=await page.evaluate(()=>({weeks:JSON.stringify(state.weeks),supp:JSON.stringify(state.suppChecks),old:getWeekPlan(1).d1_main}));
    await page.evaluate(()=>{document.getElementById('weekSelect').value=16;changeWeek();});
    assert.equal(await page.evaluate(()=>protectedThrough()),1,'navigation must not protect future weeks');
    const patch={schema:'metajhim.coach-patch.v1',plan:[{w:1,d1_main:'DO NOT CHANGE'},{w:2,d1_main:'107.5 кг: 4×6 (RIR 2)'}],weeks:{1:{reps100:99}},suppChecks:{},lastInjectDate:'2030-01-01'};
    await page.evaluate(()=>openImportModal());
    await page.locator('#importJsonArea').fill(JSON.stringify(patch));
    await page.getByRole('button',{name:'Проверить патч',exact:true}).click();
    assert.match(await page.locator('#patchPreview').innerText(),/Пропущены недели: 1/);
    await page.locator('#applyPatchButton').click();
    const after=await page.evaluate(()=>({weeks:JSON.stringify(state.weeks),supp:JSON.stringify(state.suppChecks),old:getWeekPlan(1).d1_main,new:getWeekPlan(2).d1_main,date:state.lastInjectDate}));
    assert.equal(after.weeks,before.weeks);assert.equal(after.supp,before.supp);assert.equal(after.old,before.old);assert.match(after.new,/107.5/);assert.equal(after.date,'2026-10-18');
    assert.equal(await page.evaluate(()=>localStorage.getItem('metajhim_dmitry_v4')),null);
    console.log('PASS: safe coach patch, protected history and supplement marks, zero values, HTML escaping');

    const invalids=[{plan:[{w:17,d1_main:'x'}]},{plan:[{w:2,target100:-1}]},{plan:[{w:2,d1_main:'a'},{w:2,d1_main:'b'}]},{settings:{compDate:'2026-02-30'}},{plan:[{w:2,d1_main:'x'},{w:3,isDeload:'false'}]},JSON.parse('{"__proto__":{}}')];
    for(const invalid of invalids){const result=await page.evaluate(raw=>{const before=JSON.stringify(state);try{preparePatch(JSON.parse(raw));return false;}catch{return before===JSON.stringify(state);}},JSON.stringify(invalid));assert(result,JSON.stringify(invalid));}
    const downloadPromise=page.waitForEvent('download');await page.evaluate(()=>exportJSON());const download=await downloadPromise;const saved=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
    assert.equal(saved.schema,'metajhim.backup.v2');assert.equal(saved.customPlan.length,16);assert.equal(saved.suppChecks['2026-11-23_clomid'],true);
    await page.evaluate(()=>openImportModal());await page.locator('#importJsonArea').fill(JSON.stringify(saved));
    page.once('dialog',d=>d.accept());await page.evaluate(()=>restoreBackup());
    assert.equal(await page.evaluate(()=>state.suppChecks['2026-11-23_clomid']),true);
    await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw Error('denied');}},configurable:true}));
    await page.evaluate(()=>copyWeeklyReport());
    assert(await page.locator('#reportModal').isVisible());
    const report=await page.locator('#reportArea').inputValue();assert.equal(JSON.parse(report.split('\n').at(-1)).schema,'metajhim.weekly-report.v1');
    await page.locator('#reportModal button').click();
    console.log('PASS: atomic validation, archive round trip, clipboard fallback');

    // Simulate denied storage; a patch must not change the live plan.
    assert(await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=()=>{throw Error('quota');};const before=JSON.stringify(state);const p=preparePatch({plan:[{w:3,d1_main:'DO NOT APPLY'}]});const ok=saveToStorage(p.next);Storage.prototype.setItem=original;return !ok&&before===JSON.stringify(state);}));
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>selectWeek(1));
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile horizontal overflow');
    fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
    await page.screenshot({path:path.join(root,'test-results','mobile.png'),fullPage:true});
    await page.setViewportSize({width:1440,height:1000});
    await page.screenshot({path:path.join(root,'test-results','desktop.png'),fullPage:true});
    await page.clock.setSystemTime(new Date('2026-10-20T12:00:00Z'));
    await page.evaluate(()=>updatePctCountdown());
    await page.locator('.pct-card').screenshot({path:path.join(root,'test-results','pct-desktop.png')});
    await page.locator('.pct-details summary').click();
    assert(await page.locator('#pctSchedule').isVisible());
    await page.locator('.pct-card').screenshot({path:path.join(root,'test-results','pct-expanded.png')});
    await page.locator('.pct-details summary').click();
    await page.setViewportSize({width:390,height:844});
    await page.locator('.pct-card').screenshot({path:path.join(root,'test-results','pct-mobile.png')});
    console.log('PASS: storage failure protection, mobile layout');

    const legacy=await browser.newContext();const legacyPage=await legacy.newPage();
    await legacyPage.clock.install({time:new Date('2026-10-19T12:00:00Z')});
    await legacyPage.addInitScript(()=>localStorage.setItem('metajhim_dmitry_v4',JSON.stringify({version:4,targetReps:24,compDate:'2027-02-21',activeWeek:1,suppChecks:{'2026-10-19_zinc':true},customPlan:null,weeks:{1:{reps100:'16',shoulder:'0',d1_fact:'legacy'}}})));
    await legacyPage.goto(url);
    assert.equal(await legacyPage.evaluate(()=>state.weeks[1].shoulderLeft),'0');
    assert.equal(await legacyPage.locator('[data-supp-key="2026-10-19_zinc"]').isChecked(),true);
    await legacyPage.locator('#factShoulderRight').fill('0');
    assert.equal(await legacyPage.evaluate(()=>JSON.parse(localStorage.getItem('metajhim_dmitry_v2')).weeks[1].d1_fact),'legacy');
    const bad=await browser.newContext();const badPage=await bad.newPage();await badPage.addInitScript(()=>localStorage.setItem('metajhim_dmitry_v2','broken JSON'));await badPage.goto(url);
    assert(await badPage.locator('#storageWarning').isVisible());await badPage.locator('#factRIR').fill('1');assert.equal(await badPage.evaluate(()=>localStorage.getItem('metajhim_dmitry_v2')),'broken JSON');
    console.log('PASS: v4 migration, legacy shoulder migration, damaged-storage preservation');
    assert.deepEqual(errors,[]);
    const diaryContext=await browser.newContext({viewport:{width:1440,height:1000}}),diary=await diaryContext.newPage();
    diary.on('pageerror',e=>errors.push(e.message));await diary.clock.install({time:new Date('2026-10-20T12:00:00Z')});await diary.goto(url);
    const first=()=>diary.locator('.exercise-card').first();
    const openFirst=async()=>{if(await first().locator('.exercise-toggle').getAttribute('aria-expanded')==='false')await first().locator('.exercise-toggle').click();};
    assert.equal(await diary.locator('#diaryDays').getByRole('tab').count(),3);assert.equal(await first().locator('.set-row').count(),4);
    assert.equal(await first().locator('.exercise-toggle').getAttribute('aria-expanded'),'false');assert.equal(await first().locator('.exercise-body').isVisible(),false);await openFirst();
    assert.equal(await diary.locator('input[type="file"]').count(),0);
    await first().locator('.set-row').first().locator('input').nth(0).fill('100');
    await first().locator('.set-row').first().locator('input').nth(1).fill('17');
    await first().locator('.set-row').first().locator('input').nth(2).fill('0');
    await first().locator('.exercise-comment').fill(attack);
    assert.match(await diary.locator('#metricReps').innerText(),/^17/);
    assert.match(await diary.locator('#repsReadout').innerText(),/17 повт/);
    await diary.locator('#repsWeek3').hover();assert.match(await diary.locator('#repsReadout').innerText(),/нет записи/);
    await diary.locator('#repsWeek1').focus();await diary.locator('#repsWeek1').press('ArrowRight');assert.match(await diary.locator('#repsReadout').innerText(),/Неделя 2/);
    await diary.locator('#legend-plan').click();assert.equal(await diary.locator('#repsChart [data-series="plan"]').count(),0);assert.equal(await diary.locator('#repsChart [data-series="fact"]').count(),1);
    await diary.locator('#legend-plan').click();assert.equal(await diary.locator('#repsChart [data-series="plan"]').count(),1);
    await first().getByRole('button',{name:'+ Добавить подход',exact:true}).click();assert.equal(await first().locator('.set-row').count(),5);
    await diary.getByRole('tab',{name:/Среда/}).click();await openFirst();await first().locator('.set-row').first().locator('input').nth(0).fill('80');
    await diary.locator('#diaryWeekSelect').selectOption('2');await openFirst();await first().locator('.set-row').first().locator('input').nth(0).fill('90');
    await diary.reload();assert.equal(await first().locator('.set-row').first().locator('input').nth(0).inputValue(),'90');assert.equal(await first().locator('.exercise-toggle').getAttribute('aria-expanded'),'false');await openFirst();
    await first().locator('.set-row').first().locator('input').nth(0).fill('100');await first().locator('.set-row').first().locator('input').nth(1).fill('19');
    assert.equal(await diary.locator('#repsChart [data-series="fact"] polyline').count(),1);assert.match(await diary.locator('#repsBestValue').innerText(),/19/);
    await diary.locator('#factWeight').fill('98.2');await diary.locator('#factShoulder').fill('0');
    await diary.locator('#healthWeightTab').click();assert.match(await diary.locator('#healthLatestValue').innerText(),/98.2/);assert.match(await diary.locator('#healthChart svg').getAttribute('aria-label'),/килограммах/);
    await diary.locator('#healthShoulderTab').click();assert.match(await diary.locator('#healthLatestValue').innerText(),/0.*\/ 10/);assert.match(await diary.locator('#healthReadout').innerText(),/Без дискомфорта/);
    await diary.locator('#healthWeek3').hover();assert.match(await diary.locator('#healthReadout').innerText(),/нет записи/);
    await diary.locator('#healthShoulderTab').press('ArrowLeft');assert.equal(await diary.locator('#healthWeightTab').getAttribute('aria-selected'),'true');
    await diary.locator('#diaryWeekSelect').selectOption('1');assert.equal(await first().locator('.set-row').count(),5);
    assert.equal(await first().locator('.exercise-comment').inputValue(),attack);assert.equal(await diary.evaluate(()=>window.injected),undefined);
    const journalPayload=await diary.evaluate(()=>weeklyPayload());assert.equal(journalPayload.fact.workouts.d1.exercises[0].sets[0].rir,0);assert.equal(journalPayload.fact.reps100,17);assert(journalPayload.plan.days.d1.length);
    assert.match(await diary.evaluate(()=>reportText()),/100 кг × 17 повт\. · RIR 0/);
    const journalDownload=diary.waitForEvent('download');await diary.evaluate(()=>exportJSON());const journalBackup=JSON.parse(fs.readFileSync(await (await journalDownload).path(),'utf8'));
    await diary.evaluate(()=>openImportModal());await diary.locator('#importJsonArea').fill(JSON.stringify(journalBackup));diary.once('dialog',d=>d.accept());await diary.evaluate(()=>restoreBackup());
    assert.equal(await first().locator('.set-row').first().locator('input').nth(1).inputValue(),'17');
    await diary.getByRole('tab',{name:/Среда/}).click();assert.equal(await first().locator('.set-row').first().locator('input').nth(0).inputValue(),'80');
    await diary.getByRole('tab',{name:/Понедельник/}).click();await diary.locator('#diaryDay1').press('ArrowRight');assert.equal(await diary.locator('#diaryDay2').getAttribute('aria-selected'),'true');
    await diary.getByRole('tab',{name:/Понедельник/}).click();
    await openFirst();
    await first().locator('.exercise-comment').fill('Техника ровная, без дискомфорта.');
    await diary.evaluate(()=>{document.getElementById('toastBox').style.display='none';});
    await diary.locator('.diary').screenshot({path:path.join(root,'test-results','diary-desktop.png')});
    await diary.screenshot({path:path.join(root,'test-results','theme-desktop.png'),fullPage:true});
    await diary.locator('.charts').screenshot({path:path.join(root,'test-results','charts-desktop.png')});
    await diary.locator('#healthShoulderTab').click();await diary.locator('.charts').screenshot({path:path.join(root,'test-results','charts-shoulder.png')});
    await diary.setViewportSize({width:390,height:844});assert(await diary.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await diary.locator('.charts').screenshot({path:path.join(root,'test-results','charts-mobile.png')});
    await first().screenshot({path:path.join(root,'test-results','diary-mobile.png')});
    assert.equal(await diary.locator('.bio-panel').count(),0);assert.deepEqual(errors,[]);
    console.log('PASS: structured diary, isolated days/weeks, added sets, derived 100 kg result, JSON restore, accessible tabs, mobile theme');
    for(const prefix of ['/','/metajhim/']){
      // A regular disposable profile is required: incognito intentionally blocks PWA installation.
      const pwaContext=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(root,'test-results','pwa-profile-')),{headless:true,...(process.env.TEST_BROWSER_CHANNEL?{channel:process.env.TEST_BROWSER_CHANNEL}:{})}),pwa=await pwaContext.newPage();pwa.on('pageerror',e=>errors.push(e.message));
      try{
      await pwa.goto(url+prefix);await pwa.evaluate(()=>navigator.serviceWorker.ready);await pwa.waitForFunction(()=>!!navigator.serviceWorker.controller);
      const manifestURL=await pwa.locator('link[rel="manifest"]').getAttribute('href');
      const manifest=await pwa.evaluate(async href=>await (await fetch(href)).json(),manifestURL);
      assert.equal(manifest.display,'standalone');assert.equal(new URL(manifest.start_url,url+prefix+'manifest.webmanifest').pathname,prefix);
      const cdp=await pwaContext.newCDPSession(pwa);const installation=await cdp.send('Page.getInstallabilityErrors');assert.deepEqual(installation.installabilityErrors,[],prefix);
      for(const icon of manifest.icons){const info=await pwa.evaluate(async src=>{const response=await fetch(src);const image=await createImageBitmap(await response.blob());return {width:image.width,height:image.height};},icon.src);const size=Number(icon.sizes.split('x')[0]);assert.deepEqual(info,{width:size,height:size});}
      const requestsBeforeOffline=documentRequests;await pwaContext.setOffline(true);await pwa.reload();assert.equal(await pwa.locator('h1').innerText(),'MetaJhim 100 · подготовка к КМС');
      assert.equal(documentRequests,requestsBeforeOffline,'Offline reload must use cache, not the test server');
      console.log('PWA offline state:',prefix,await pwa.evaluate(()=>({online:navigator.onLine,hidden:document.getElementById('pwaOfflineStatus').hidden})));
      const card=pwa.locator('.exercise-card').first();assert.equal(await card.locator('.exercise-toggle').getAttribute('aria-expanded'),'false');await card.locator('.exercise-toggle').click();await card.locator('.set-row input').first().fill('100');
      await pwa.reload();assert.equal(await card.locator('.exercise-toggle').getAttribute('aria-expanded'),'false');assert.equal(await card.locator('.set-row input').first().inputValue(),'100');
      await pwaContext.setOffline(false);await pwa.reload();assert.equal(await pwa.locator('#pwaOfflineStatus').isVisible(),false);
      await pwa.evaluate(()=>{installPrompt=null;showInstallHelp();});assert(await pwa.locator('#pwaInstallDialog').isVisible());await pwa.locator('#pwaInstallDialog button').click();
      // Accepting a prompt is not proof of completed OS installation.
      await pwa.evaluate(async()=>{installPrompt={prompt:async()=>{},userChoice:Promise.resolve({outcome:'accepted'})};await installPwa();});
      assert(await pwa.locator('#installAppButton').isVisible());assert.equal(await pwa.locator('#installAppButton').isEnabled(),true);
      const oldState=await pwa.evaluate(()=>localStorage.getItem('metajhim_dmitry_v2'));
      await pwa.goto(url+prefix+'?install=repair');
      assert.equal(await pwa.locator('link[rel="manifest"]').getAttribute('href'),'./manifest-repair.webmanifest');
      const repairManifest=await pwa.evaluate(async()=>await (await fetch(document.querySelector('link[rel="manifest"]').href)).json());
      assert.notEqual(repairManifest.id,manifest.id);assert.equal(repairManifest.start_url,'./?install=repair');
      assert.equal(await pwa.evaluate(()=>localStorage.getItem('metajhim_dmitry_v2')),oldState);
      assert.equal(await pwa.locator('#installAppButton').innerText(),'Установить повторно');
      const repairErrors=await cdp.send('Page.getInstallabilityErrors');assert.deepEqual(repairErrors.installabilityErrors,[]);
      await pwaContext.setOffline(true);await pwa.reload();assert.equal(await pwa.locator('link[rel="manifest"]').getAttribute('href'),'./manifest-repair.webmanifest');
      await pwaContext.setOffline(false);
      await pwa.evaluate(()=>window.dispatchEvent(new Event('appinstalled')));assert.equal(await pwa.locator('#installAppButton').isVisible(),false);
      }finally{await pwaContext.close();}
    }
    assert.deepEqual(errors,[]);console.log('PASS: collapsed on reopen, installability, manifest and icons, offline diary on / and /metajhim/');
    let cloudRow=null,networkDown=false;
    const uid='11111111-1111-4111-8111-111111111111';
    async function cloudMock(route){
      if(networkDown){await route.abort('failed');return;}
      const req=route.request(),target=new URL(req.url()),body=req.postDataJSON();
      const reply=(status,data)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
      if(target.pathname==='/auth/v1/token')return reply(200,{access_token:'mock-access',refresh_token:'mock-refresh',expires_in:3600,user:{id:uid,email:'owner@example.test'}});
      if(target.pathname==='/auth/v1/logout')return reply(200,{});
      assert.equal(req.headers().authorization,'Bearer mock-access');
      if(req.method()==='GET')return reply(200,cloudRow?[cloudRow]:[]);
      if(req.method()==='POST'){if(cloudRow)return reply(409,{code:'23505'});cloudRow=structuredClone(body);return reply(201,[cloudRow]);}
      if(req.method()==='PATCH'){if(target.searchParams.get('revision')!=='eq.'+cloudRow.revision)return reply(200,[]);cloudRow={...cloudRow,...structuredClone(body)};return reply(200,[cloudRow]);}
      return reply(404,{});
    }
    const ca=await browser.newContext(),cb=await browser.newContext();await ca.route('https://vybgmqjilhfsythiutnw.supabase.co/**',cloudMock);await cb.route('https://vybgmqjilhfsythiutnw.supabase.co/**',cloudMock);
    const a=await ca.newPage(),b=await cb.newPage();for(const p of [a,b]){p.on('pageerror',e=>errors.push(e.message));await p.goto(url);}
    async function signIn(p){await p.locator('#cloudOpenButton').click();await p.locator('#cloudEmail').fill('owner@example.test');await p.locator('#cloudPassword').fill('mock-password');await p.locator('#cloudLoginButton').click();await p.waitForFunction(()=>document.getElementById('cloudDialog').open===false);}
    await signIn(a);await a.waitForFunction(()=>document.getElementById('cloudStatus').textContent.startsWith('Синхронизировано'));assert(cloudRow);
    await b.evaluate(()=>{state.weeks[1].weight=99;saveToStorage();});await signIn(b);await b.waitForFunction(()=>!document.getElementById('cloudConflict').hidden);
    assert.equal(cloudRow.data.weeks[1].weight,100);assert(await b.evaluate(()=>!!JSON.parse(localStorage.getItem('metajhim_cloud_backup_v1')).local));
    await b.getByRole('button',{name:'Использовать облачный дневник',exact:true}).click();await b.waitForFunction(()=>document.getElementById('cloudConflict').hidden);assert.equal(await b.locator('#factWeight').inputValue(),'100');
    await a.evaluate(()=>{state.weeks[1].notes='Заметка с телефона';saveToStorage();});await a.evaluate(()=>MetaJhimCloud.sync());await b.evaluate(()=>MetaJhimCloud.sync());assert.equal(await b.locator('#weekNotes').inputValue(),'Заметка с телефона');
    // Distinct edits merge; conflicting edits pause and leave the server version intact.
    await a.evaluate(()=>{state.weeks[1].notes='Запись A';saveToStorage();});await b.evaluate(()=>{state.weeks[1].weight=98.5;saveToStorage();});await a.evaluate(()=>MetaJhimCloud.sync());await b.evaluate(()=>MetaJhimCloud.sync());assert.equal(cloudRow.data.weeks[1].notes,'Запись A');assert.equal(cloudRow.data.weeks[1].weight,98.5);
    await a.evaluate(()=>MetaJhimCloud.sync());await a.evaluate(()=>{state.weeks[1].notes='Конфликт A';saveToStorage();});await b.evaluate(()=>{state.weeks[1].notes='Конфликт B';saveToStorage();});await a.evaluate(()=>MetaJhimCloud.sync());await b.evaluate(()=>MetaJhimCloud.sync());assert(await b.locator('#cloudConflict').isVisible());assert.equal(cloudRow.data.weeks[1].notes,'Конфликт A');
    await b.getByRole('button',{name:'Использовать облачный дневник',exact:true}).click();await b.waitForFunction(()=>document.getElementById('cloudConflict').hidden);
    networkDown=true;await b.evaluate(()=>{state.weeks[1].notes='Запись без сети';saveToStorage();});await b.evaluate(()=>MetaJhimCloud.sync());assert.equal(await b.evaluate(()=>JSON.parse(localStorage.getItem('metajhim_dmitry_v2')).weeks[1].notes),'Запись без сети');assert.equal(cloudRow.data.weeks[1].notes,'Конфликт A');
    networkDown=false;await b.evaluate(()=>MetaJhimCloud.sync());assert.equal(cloudRow.data.weeks[1].notes,'Запись без сети');await b.reload();await b.waitForFunction(()=>document.getElementById('cloudStatus').textContent.startsWith('Синхронизировано'));assert.equal(await b.locator('#weekNotes').inputValue(),'Запись без сети');
    assert.equal(await b.evaluate(()=>localStorage.getItem('metajhim_dmitry_v2').includes('mock-access')),false);await b.evaluate(()=>MetaJhimCloud.logout());assert.equal(await b.evaluate(()=>localStorage.getItem('metajhim_cloud_session_v1')),null);assert(await b.evaluate(()=>!!localStorage.getItem('metajhim_dmitry_v2')));
    await ca.close();await cb.close();assert.deepEqual(errors,[]);console.log('PASS: cloud login, first sync choice, cross-device pull, merge, conflict backup, offline queue, session restore, logout');
    console.log('ALL CHECKS PASSED');
  } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
