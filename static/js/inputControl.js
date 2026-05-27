const replicatedActionTargets = {
    serials: new Set(),
    has(serial) {
        return this.serials.has(serial);
    },
    add(serial) {
        this.serials.add(serial);
    },
    delete(serial) {
        this.serials.delete(serial);
    },
    toggle(serial) {
        if (this.has(serial)) {
            this.delete(serial);
            return false;
        }

        this.add(serial);
        return true;
    },
    size() {
        return this.serials.size;
    },
    withSource(sourceSerial) {
        const serials = new Set(this.serials);
        serials.add(sourceSerial);
        return serials;
    }
};

function setReplicatedActionTarget(view, selected) {
    if (selected) {
        replicatedActionTargets.add(view.serial);
    } else {
        replicatedActionTargets.delete(view.serial);
    }

    view.wrapper.classList.toggle('is-replicated-action-target', selected);
    view.card.title = selected
        ? 'Selezionato per replica comandi'
        : '';
    setSummary();
}

function toggleReplicatedActionTarget(view) {
    setReplicatedActionTarget(view, !replicatedActionTargets.has(view.serial));
}

function isReplicatedActionTargetEvent(event) {
    return event.metaKey || event.ctrlKey;
}

function getControlTargetSerials(sourceSerial) {
    return [...replicatedActionTargets.withSource(sourceSerial)].map((serial) => deviceViews.get(serial)).filter((view) => {
        return view && view.status === 'connected';
    });
}