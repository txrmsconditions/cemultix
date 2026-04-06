export class RoomDO {
  constructor(state) {
    this.state = state;
    this.room = null;
  }

  requiredHintVotes(totalPlayers) {
    // Plus de 2/3 des joueurs doivent voter oui.
    return Math.floor((Math.max(1, totalPlayers) * 2) / 3) + 1;
  }

  sanitizeActivePlayers() {
    if (!this.room) return;
    this.room.players = this.room.players.filter(
      p => !p.lastSeen || Date.now() - p.lastSeen < 10000
    );
  }

  hintStatusFor(viewer = '') {
    const now = Date.now();
    const availableAt = (this.room?.createdAt || now) + 90_000;
    const secondsRemaining = Math.max(0, Math.ceil((availableAt - now) / 1000));
    const hint = this.room?.hint || { revealed: false, category: null, proposal: null };
    const status = {
      availableAt,
      secondsRemaining,
      revealed: !!hint.revealed,
      category: hint.revealed ? (hint.category || this.room?.secretCategory || null) : null,
      proposal: null,
    };
    if (hint.proposal && !hint.revealed) {
      const totalPlayers = Math.max(1, (this.room?.players || []).length);
      const needed = this.requiredHintVotes(totalPlayers);
      const votesYes = Array.isArray(hint.proposal.votesYes) ? hint.proposal.votesYes : [];
      status.proposal = {
        id: hint.proposal.id,
        proposer: hint.proposal.proposer,
        yesVotes: votesYes.length,
        totalPlayers,
        needed,
        userVoted: !!viewer && votesYes.includes(viewer),
      };
    }
    return status;
  }

  evaluateHintVotes() {
    if (!this.room || !this.room.hint || this.room.hint.revealed) return false;
    const proposal = this.room.hint.proposal;
    if (!proposal) return false;
    this.sanitizeActivePlayers();
    const totalPlayers = Math.max(1, this.room.players.length);
    const votesYes = Array.isArray(proposal.votesYes) ? proposal.votesYes.length : 0;
    const needed = this.requiredHintVotes(totalPlayers);
    if (votesYes >= needed) {
      this.room.hint.revealed = true;
      this.room.hint.revealedAt = Date.now();
      this.room.hint.category = this.room.secretCategory || this.room.hint.category || null;
      this.room.hint.proposal = null;
      return true;
    }
    return false;
  }

  async load() {
    if (!this.room) this.room = await this.state.storage.get('room') || null;
    return this.room;
  }
  async save() { await this.state.storage.put('room', this.room); }

  // ── DO Alarm : nettoyage automatique ─────────────────────
  async alarm() {
    // Appelé par Cloudflare après le délai défini dans scheduleCleanup()
    await this.state.storage.deleteAll();
    this.room = null;
  }

  scheduleCleanup(delayMs) {
    const at = Date.now() + delayMs;
    this.state.storage.setAlarm(at);
  }

  // ── Heartbeat & inactivité ────────────────────────────────
  async updateActivity() {
    // Repousse l'alarme d'inactivité à +20min
    this.scheduleCleanup(20 * 60 * 1000);
  }

  async fetch(req) {
    const url = new URL(req.url);
    const p   = url.pathname;
    const m   = req.method;

    // POST /init
    if (p === '/init' && m === 'POST') {
      const b = await req.json();
      this.room = {
        code: b.code, name: b.roomName,
        maxPlayers: b.maxPlayers, mode: b.mode,
        showOtherWords: !!b.showOtherWords,
        secret: b.secret, wordNumber: b.wordNumber,
        secretCategory: b.secretCategory || null,
        players: [], guesses: [],
        winner: null, finished: false,
        winnerEvent: null,
        hint: {
          revealed: false,
          revealedAt: null,
          category: b.secretCategory || null,
          proposal: null,
        },
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };
      await this.save();
      // Démarre le timer d'inactivité : supprime après 20min sans activité
      this.scheduleCleanup(20 * 60 * 1000);
      return ok({
        mode: this.room.mode,
        wordNumber: this.room.wordNumber,
        showOtherWords: this.room.mode === 'race' ? !!this.room.showOtherWords : true,
        gameStartedAt: this.room.createdAt,
        hint: this.hintStatusFor(''),
        players: [],
      });
    }

    // POST /join
    if (p === '/join' && m === 'POST') {
      await this.load();
      if (!this.room)               return ok({ error: 'Salle introuvable' }, 404);
      if (this.room.finished)       return ok({ error: 'Partie terminée' }, 403);
      if (this.room.players.length >= this.room.maxPlayers)
                                    return ok({ error: 'Salle pleine' }, 403);
      this.room.lastActivity = Date.now();
      await this.save();
      await this.updateActivity();
      return ok({
        mode: this.room.mode, wordNumber: this.room.wordNumber,
        showOtherWords: this.room.mode === 'race' ? !!this.room.showOtherWords : true,
        gameStartedAt: this.room.createdAt,
        hint: this.hintStatusFor(''),
        players: this.room.players,
        guesses: this.room.mode === 'coop' ? this.room.guesses : [],
      });
    }

    // POST /heartbeat
    if (p === '/heartbeat' && m === 'POST') {
      await this.load();
      if (!this.room) return ok({ error: 'Salle introuvable' }, 404);
      const { username } = await req.json();
      let pl = this.room.players.find(p => p.username === username);
      if (!pl) { pl = { username, tries: 0, found: false }; this.room.players.push(pl); }
      pl.lastSeen = Date.now();
      this.room.lastActivity = Date.now();
      // Retire les joueurs inactifs depuis plus de 10s
      this.sanitizeActivePlayers();
      this.evaluateHintVotes();
      await this.save();
      await this.updateActivity();
      return ok({ ok: true });
    }

    // GET /state
    if (p === '/state' && m === 'GET') {
      await this.load();
      if (!this.room) return ok({ error: 'Salle introuvable' }, 404);
      this.sanitizeActivePlayers();
      this.evaluateHintVotes();
      await this.save();
      const since = parseInt(url.searchParams.get('since') || '0');
      const viewer = String(url.searchParams.get('user') || '');
      const canSeeAllWords = this.room.mode !== 'race' || !!this.room.showOtherWords;
      const newGuesses = this.room.guesses
        .filter(g => g.ts > since)
        .map(g => {
          const mine = g.player === viewer;
          if (canSeeAllWords || mine) {
            return {
              word: g.word,
              wordLength: g.wordLength || (g.word ? g.word.length : 0),
              player: g.player,
              rank: g.rank,
              proximity: g.proximity,
              found: !!g.found,
              ts: g.ts,
            };
          }
          return {
            word: null,
            wordLength: g.wordLength || (g.word ? g.word.length : 0),
            player: g.player,
            rank: null,
            proximity: g.proximity,
            found: !!g.found,
            hidden: true,
            ts: g.ts,
          };
        });
      const winnerEvent = this.room.winnerEvent && this.room.winnerEvent.ts > since
        ? this.room.winnerEvent
        : null;
      return ok({
        players:  this.room.players,
        guesses:  newGuesses,
        winner:   this.room.winner,
        winnerEvent,
        finished: this.room.finished,
        mode:     this.room.mode,
        showOtherWords: this.room.mode === 'race' ? !!this.room.showOtherWords : true,
        gameStartedAt: this.room.createdAt,
        hint: this.hintStatusFor(viewer),
        serverTs: Date.now(),
      });
    }

    // POST /hint/propose
    if (p === '/hint/propose' && m === 'POST') {
      await this.load();
      if (!this.room) return ok({ error: 'Salle introuvable' }, 404);
      if (this.room.mode === 'solo') return ok({ error: 'Non disponible en solo' }, 400);
      const now = Date.now();
      const availableAt = (this.room.createdAt || now) + 90_000;
      if (now < availableAt) {
        return ok({
          error: 'Indice disponible après 1m30',
          secondsRemaining: Math.ceil((availableAt - now) / 1000),
          hint: this.hintStatusFor(''),
        }, 403);
      }
      if (this.room.hint?.revealed) {
        return ok({ ok: true, revealed: true, hint: this.hintStatusFor('') });
      }

      const { username } = await req.json();
      if (!username) return ok({ error: 'Pseudo requis' }, 400);

      this.sanitizeActivePlayers();
      if (!this.room.players.find(p => p.username === username)) {
        this.room.players.push({ username, tries: 0, found: false, lastSeen: now });
      }

      if (!this.room.hint) {
        this.room.hint = {
          revealed: false,
          revealedAt: null,
          category: this.room.secretCategory || null,
          proposal: null,
        };
      }

      if (!this.room.hint.proposal) {
        this.room.hint.proposal = {
          id: crypto.randomUUID(),
          proposer: username,
          createdAt: now,
          votesYes: [username],
        };
      } else if (!this.room.hint.proposal.votesYes.includes(username)) {
        this.room.hint.proposal.votesYes.push(username);
      }

      const revealedNow = this.evaluateHintVotes();
      this.room.lastActivity = now;
      await this.save();
      await this.updateActivity();
      return ok({ ok: true, revealed: revealedNow, hint: this.hintStatusFor(username) });
    }

    // GET /secret
    if (p === '/secret') {
      await this.load();
      if (!this.room) return ok({ error: 'Salle introuvable' }, 404);
      return ok({ secret: this.room.secret, wordNumber: this.room.wordNumber });
    }

    // POST /guess
    if (p === '/guess' && m === 'POST') {
      await this.load();
      if (!this.room) return ok({ error: 'Salle introuvable' }, 404);
      const { word, username, rank, proximity, found } = await req.json();
      const pl = this.room.players.find(p => p.username === username);
      if (pl) { pl.tries = (pl.tries || 0) + 1; if (found) pl.found = true; }
      const now = Date.now();
      this.room.guesses.push({
        word,
        wordLength: word ? word.length : 0,
        player: username,
        rank,
        proximity,
        found: !!found,
        ts: now,
      });
      if (this.room.guesses.length > 1000) this.room.guesses = this.room.guesses.slice(-1000);
      this.room.lastActivity = now;

      if (found && !this.room.winner) {
        this.room.winner = username;
        this.room.finished = (this.room.mode === 'race');
        this.room.winnerEvent = {
          ts: now,
          winner: username,
          word,
          durationMs: Math.max(0, now - (this.room.createdAt || now)),
          totalGuesses: this.room.guesses.length,
          mode: this.room.mode,
        };
        // En mode race : supprime la salle 15min après la victoire
        if (this.room.mode === 'race') {
          this.scheduleCleanup(15 * 60 * 1000);
        }
      } else {
        // Repousse le timer d'inactivité
        await this.updateActivity();
      }

      await this.save();
      return ok({ ok: true });
    }

    return ok({ error: 'Route DO inconnue' }, 404);
  }
}

function ok(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}