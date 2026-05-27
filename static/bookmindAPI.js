async function sendAccountMovement(button) {

    const devicesAcions = button.closest('.device-actions');

    const typeSelect = devicesAcions.querySelector(`.type_of_select`);
    const bookmakerSelect = devicesAcions.querySelector(`.bookmaker-select`);
    const friendId = devicesAcions.closest('.device-card').dataset.friendid;
    const eventNameInput = devicesAcions.querySelector(`.event-name`);
    const amountInput = devicesAcions.querySelector(`input[type="number"]`);

    const response = await fetch('/api/sendAccountMovement', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            type_of: typeSelect.value,
            bookmaker: bookmakerSelect.value,
            friend: friendId,
            event_name: eventNameInput.value,
            stake: amountInput.value
        })
    });

    if (response.ok) {
        const result = await response.json();
        amountInput.value = '';
    } else alert('Errore nell\'invio dell\'azione');

    }
