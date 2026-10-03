async function loadFiles(paths) {
  const results = await Promise.all(paths.map(path => fetch(path, { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error(path + ': ' + r.status); return r.text(); })));
  return results.join('');
}
(async () => {
  try {
    const css = await loadFiles(Array.from({length: 4}, (_, i) => `./style-${String(i+1).padStart(2,'0')}.css`));
    const app = await loadFiles(Array.from({length: 5}, (_, i) => `./app-${String(i+1).padStart(2,'0')}.js`));
    const style = document.createElement('style');
    style.id = 'tabinetRuntimeStyles';
    style.textContent = css;
    document.head.appendChild(style);
    (0, eval)(app);
  } catch (error) {
    console.error('Tabinet bootstrap failed', error);
    const el = document.getElementById('loadingText');
    if (el) el.textContent = 'Nu s-a putut încărca jocul. Reîncarcă pagina.';
  }
})();