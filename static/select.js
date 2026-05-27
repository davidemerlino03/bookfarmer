let bookmakersPromise = null;

function normalizeBookmakers(bookmakers) {
  const items = Array.isArray(bookmakers) ? bookmakers : Object.values(bookmakers || {});
  return items.filter((bookmaker) => bookmaker && typeof bookmaker.name === 'string' && bookmaker.name.length > 0);
}

async function loadBookmakers() {
  if (!bookmakersPromise) {
    bookmakersPromise = (async () => {
      let cached = [];
      try {
        cached = normalizeBookmakers(JSON.parse(localStorage.getItem('bookmakers') || '[]'));
      } catch (error) {
        localStorage.removeItem('bookmakers');
      }

      if (cached.length > 0) {
        return cached;
      }

      const response = await fetch('/bookmakers');
      if (!response.ok) {
        throw new Error(`Bookmakers request failed: ${response.status}`);
      }

      const bookmakers = await response.json();
      const items = normalizeBookmakers(bookmakers);
      localStorage.setItem('bookmakers', JSON.stringify(items));
      return items;
    })();
  }

  try {
    return await bookmakersPromise;
  } catch (error) {
    bookmakersPromise = null;
    throw error;
  }
}

// 🔧 Funzione generica per popolare qualsiasi select
async function populateSelect(selectEl, source, mapFn, selected, defaultOption = false) {

  const data = await source();

  // Pulisce la select
  selectEl.replaceChildren();

  // Mappa e aggiunge le option
  const items = Array.isArray(data) ? data : Object.values(data || {});

  if (defaultOption == true){
    const opt = new Option('Seleziona', "");
    selectEl.add(opt)
  }

  items.forEach((item) => {
    const { text, value } = mapFn(item);
    const opt = new Option(text, String(value));
    selectEl.add(opt);
  });

  // Imposta il valore selezionato dopo aver popolato
  selectEl.value = String(selected);

  // Se non esiste, fallback al primo
  if (!selectEl.value && selectEl.options.length > 0) {
    selectEl.selectedIndex = 0;
  }
}

async function populateBookmakerSelect(selectEl, selected) {
  try {
    await populateSelect(
      selectEl,
      loadBookmakers,
      (b) => ({ text: b.name, value: b.name }),
      selected
    );
  } catch (error) {
    console.error('Error loading bookmakers:', error);
    selectEl.replaceChildren();
  }
}
