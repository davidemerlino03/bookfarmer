async function saveAccounts() {
    try {
        const response = await fetch('/accounts');
        const accounts = await response.json();
        if (!response.ok) {
            console.warn('Cannot fetch accounts:', accounts);
            return;
        }

        console.log('Fetched accounts:', accounts);
        localStorage.setItem('accounts', JSON.stringify(accounts.grouped));
    } catch (error) {
        console.warn('Cannot fetch accounts:', error);
    }
}

async function saveBookmakers() {
    try {
        const bookmakers = typeof loadBookmakers === 'function'
            ? await loadBookmakers()
            : await (await fetch('/bookmakers')).json();

        if (bookmakers && bookmakers.ok === false) {
            console.warn('Cannot fetch bookmakers:', bookmakers);
            return;
        }

        console.log('Fetched bookmakers:', bookmakers);
        localStorage.setItem('bookmakers', JSON.stringify(bookmakers));
    } catch (error) {
        console.warn('Cannot fetch bookmakers:', error);
    }
}

async function saveFriends() {
    try {
        const response = await fetch('/friends');
        const friends = await response.json();
        if (!response.ok) {
            console.warn('Cannot fetch friends:', friends);
            return;
        }

        console.log('Fetched friends:', friends);
        localStorage.setItem('friends', JSON.stringify(friends));
    } catch (error) {
        console.warn('Cannot fetch friends:', error);
    }
}

saveAccounts();
saveBookmakers();
