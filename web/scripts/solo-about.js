/* Product documents are bundled locally and rendered as text, including licenses. */
(() => {
  const panel = document.getElementById('soloAboutPanel');
  const content = document.getElementById('soloAboutContent');
  const version = document.getElementById('soloAboutVersion');
  const words = {
    de: {title:'Über Citizen Tools', history:'Versionsverlauf', licenses:'Lizenzen', current:'Diese Version', loading:'Informationen werden geladen …', error:'Informationen konnten nicht geladen werden.', retry:'Erneut versuchen', saveHistory:'Versionsverlauf speichern', saveLicenses:'Lizenztexte speichern', own:'Citizen Tools · GPLv3 oder später', grant:'Nutzen, ändern und weitergeben – auch kommerziell. Hinweise erhalten, Änderungen kennzeichnen und bei Weitergabe Quellcode gemäß GPL bereitstellen.', scope:'GPLv3 oder später gilt für den eigenen Programmcode. Zusatzkomponenten und Spielinhalte behalten ihre jeweiligen Bedingungen.', original:'Original-Lizenztexte', source:'Projekt / Quelle', find:'Komponente oder Lizenz suchen', none:'Keine passenden Lizenztexte.', fan:'Unabhängiges Fanprojekt für Star Citizen.', notes:'Geltungsbereich & Drittanbieterhinweise'},
    en: {title:'About Citizen Tools', history:'Release history', licenses:'Licenses', current:'This version', loading:'Loading information …', error:'Information could not be loaded.', retry:'Try again', saveHistory:'Save release notes', saveLicenses:'Save license texts', own:'Citizen Tools · GPLv3 or later', grant:'Free to use, modify and redistribute, including commercially. Preserve notices, identify changes and provide source under the GPL when distributing.', scope:'GPLv3 or later applies to our original code. Additional components and game content retain their own terms.', original:'Original license texts', source:'Project / source', find:'Search components or licenses', none:'No matching license texts.', fan:'Independent fan project for Star Citizen.', notes:'Scope & third-party notices'},
  };
  let data = null, loading = false, failed = false, selected = 'history', rendered = '', search = '';
  const expanded = new Set();
  const language = () => currentUiLanguage() === 'en' ? 'en' : 'de';
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function downloadLink(text, url) {
    const link = element('a', text, 'secondary-button');
    link.href = url; link.download = ''; return link;
  }
  function documentCard(item, open=false) {
    const card = element('details', null, 'solo-license-card');
    card.dataset.document = item.id;
    card.open = open || expanded.has(item.id);
    const summary = element('summary');
    summary.append(element('strong', item.title), element('span', item.license || '', 'solo-license-type'));
    card.append(summary);
    if (item.source && /^https:\/\//.test(item.source)) {
      const source = element('a', words[language()].source);
      source.href = item.source; source.target = '_blank'; source.rel = 'noreferrer noopener'; card.append(source);
    }
    card.append(element('pre', item.text, 'solo-license-text'));
    card.addEventListener('toggle', () => card.open ? expanded.add(item.id) : expanded.delete(item.id));
    return card;
  }
  function render() {
    const lang = language(), text = words[lang];
    panel.setAttribute('aria-label', text.title);
    const key = `${lang}:${selected}:${Boolean(data)}:${loading}:${failed}`;
    if (key === rendered) return;
    rendered = key;
    content.replaceChildren();
    if (!data) {
      const message = element('p', failed ? text.error : text.loading);
      message.setAttribute('role', 'status'); content.append(message);
      if (failed) {
        const retry = element('button', text.retry, 'secondary-button'); retry.type = 'button';
        retry.addEventListener('click', () => { failed=false; void load(); }); content.append(retry);
      } else if (!loading) void load();
      return;
    }
    version.textContent = `v${data.version}`;
    const intro = element('div', null, 'solo-about-intro');
    intro.append(element('strong', text.own), element('p', text.grant), element('p', text.fan, 'solo-about-muted'));
    if (data.project) {
      intro.append(element('p', `${lang === 'en' ? 'Original project' : 'Ursprüngliches Projekt'}: ${data.project.author}`, 'solo-about-muted'));
      if (/^https:\/\//.test(data.project.repository)) {
        const repository = element('a', 'GitHub · Citizen Tools');
        repository.href = data.project.repository; repository.target = '_blank'; repository.rel = 'noreferrer noopener';
        intro.append(repository);
      }
    }
    const navigation = element('div', null, 'solo-about-navigation'); navigation.setAttribute('role','group'); navigation.setAttribute('aria-label',text.title);
    for (const section of ['history','licenses']) {
      const button = element('button', text[section], 'secondary-button'); button.type='button'; button.dataset.aboutSection=section;
      button.setAttribute('aria-pressed', String(selected===section));
      button.addEventListener('click', () => {selected=section;render();content.querySelector(`[data-about-section="${section}"]`).focus();});
      navigation.append(button);
    }
    content.append(intro,navigation);
    if(data.sourceAvailable) content.append(downloadLink(lang==='en'?'Save source code':'Quellcode speichern','./api/solo/source.zip'));
    if (selected === 'history') {
      content.append(downloadLink(text.saveHistory, `./api/solo/release-notes.txt?language=${lang}`));
      const list = element('div', null, 'solo-release-list');
      for (const release of data.releases) {
        const card = element('details', null, 'solo-release-card'); card.dataset.release=release.version;
        card.open = expanded.has(release.version) || release.version === data.version;
        const summary=element('summary');
        summary.append(element('span', `v${release.version}`, 'solo-release-version'),element('strong',release[lang].title));
        if(release.version===data.version) summary.append(element('span',text.current,'solo-release-current'));
        const changes=element('ul'); release[lang].changes.forEach(change=>changes.append(element('li',change)));
        card.append(summary,changes);
        card.addEventListener('toggle',()=>card.open?expanded.add(release.version):expanded.delete(release.version));
        list.append(card);
      }
      content.append(list);
    } else {
      content.append(element('p',text.scope,'solo-about-muted'),downloadLink(text.saveLicenses,'./api/solo/licenses.zip'));
      for(const item of data.documents.filter(item=>item.group==='project')) content.append(documentCard(item));
      content.append(element('h3',text.original));
      const filter=element('input'); filter.type='search';filter.value=search;filter.placeholder=text.find;filter.setAttribute('aria-label',text.find);filter.id='soloLicenseSearch';
      const list=element('div',null,'solo-license-list');
      const empty=element('p',text.none);empty.hidden=true;
      for(const item of data.documents.filter(item=>item.group!=='project')) {
        const card=documentCard(item); card.dataset.search=`${item.title} ${item.license} ${item.file}`.toLocaleLowerCase(); list.append(card);
      }
      const applyFilter=()=>{
        search=filter.value;
        for(const card of list.children) card.hidden=!card.dataset.search.includes(search.toLocaleLowerCase().trim());
        empty.hidden=[...list.children].some(card=>!card.hidden);
      };
      filter.addEventListener('input',applyFilter); content.append(filter,list,empty); applyFilter();
    }
  }
  async function load() {
    if(loading) return; loading=true; render();
    try {
      const result=await soloRequestJson('./api/solo/about',{cache:'no-store'},10000);
      if(!result.response.ok || !Array.isArray(result.payload.documents) || !Array.isArray(result.payload.releases)) throw new Error('about_unavailable');
      data=result.payload;failed=false;
    } catch {failed=true;}
    finally {loading=false;render();}
  }
  window.soloAbout={render};
  document.getElementById('uiLanguageSelect')?.addEventListener('change',()=>{if(data || !panel.closest('[data-settings-view]').hidden) render();});
  if (!panel.closest('[data-settings-view]').hidden) render();
})();
