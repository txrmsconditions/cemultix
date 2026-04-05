# Cémultix

**Cémultix** est un clone multijoueur entièrement vibe-codé de [Cémantix](https://cemantix.certitudes.org), le jeu de proximité sémantique en français. Trouvez le mot secret en proposant des mots — plus votre proposition est sémantiquement proche, plus votre score est élevé.

🎮 **[cemultix.games](https://cemultix.games)**

---

## Modes de jeu

| Mode | Description |
|---|---|
| 🧘 Solo | Un mot secret par jour, commun à tous |
| ⚡ Course | Mot aléatoire par salle — premier à trouver gagne |
| 🤝 Coopératif | Propositions partagées entre tous les joueurs |

## Stack technique

- **Frontend** — HTML/CSS/JS vanilla, Cloudflare Pages
- **Backend** — Cloudflare Workers (API REST)
- **Temps réel** — Cloudflare Durable Objects (polling 1.5s)
- **Stockage** — Cloudflare KV (voisins sémantiques + wordlist) + D1 SQLite (scores)
- **Modèle** — [frWac](https://embeddings.net) de Jean-Philippe Fauconnier (Word2Vec, ~1 milliard de mots français)

## Structure

```
cemultix/
├── frontend/
│   ├── index.html       # Interface complète (HTML + CSS + JS)
│   ├── favicon.svg
│   └── _headers         # Headers de sécurité Cloudflare Pages
├── worker/
│   ├── src/
│   │   ├── index.js     # API REST (routes, validation, proximité)
│   │   └── room.js      # Durable Object (état des salles, alarms)
│   ├── wrangler.toml    # Configuration Cloudflare
│   └── schema.sql       # Schéma D1
└── pipeline/
    ├── pipeline.py      # Génération des voisins sémantiques
    └── secrets.txt      # Liste des mots secrets (~1000 mots)
```

## Déployer soi-même

### Prérequis

- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) : `npm install -g wrangler`
- Python 3.11 : `py -3.11 -m pip install gensim tqdm`
- Un compte [Cloudflare](https://cloudflare.com) (le plan gratuit suffit pour commencer)

### 1. Télécharger le modèle

Le modèle Word2Vec n'est pas inclus dans ce dépôt. Téléchargez-le depuis le site de [Fauconnier](https://fauconnier.github.io/#data).

```bash
cd pipeline/
curl -L https://embeddings.net/embeddings/frWac_no_postag_no_phrase_500_skip_cut100.bin -o frWac.bin
```

### 2. Générer les données sémantiques

```bash
py -3.11 pipeline.py --model frWac.bin --secrets secrets.txt --out kv_data --top-n 10000
```

Si le fichier bulk généré est trop gros pour wrangler, découpez-le :

```python
import json
from pathlib import Path
data = json.loads(Path('kv_data/bulk/bulk_0.json').read_text())
for i in range(0, len(data), 500):
    Path(f'kv_data/bulk/chunk_{i//500}.json').write_text(json.dumps(data[i:i+500]))
```

### 3. Créer les ressources Cloudflare

```bash
wrangler login
wrangler kv namespace create KV        # notez l'ID retourné
wrangler d1 create cemantix-db         # notez l'ID retourné
```

Mettez les IDs dans `worker/wrangler.toml`, puis créez les tables :

```bash
cd worker/
wrangler d1 execute cemantix-db --remote --file=schema.sql
```

### 4. Uploader les données KV

```bash
# Depuis worker/
wrangler kv key put --remote --binding=KV "secrets"  --path="../pipeline/kv_data/secrets.json"
wrangler kv key put --remote --binding=KV "wordlist" --path="../pipeline/kv_data/wordlist.json"

# Voisins (chunks si nécessaire)
Get-ChildItem ..\pipeline\kv_data\bulk -Filter "chunk_*.json" | ForEach-Object {
    wrangler kv bulk put --remote --binding=KV $_.FullName
}
```

### 5. Déployer

```bash
# Ajouter la clé admin en secret (ne jamais la mettre dans wrangler.toml)
wrangler secret put ADMIN_KEY

# Déployer le Worker
cd worker/
wrangler deploy

# Mettre à jour l'URL de l'API dans frontend/index.html, puis déployer
wrangler pages deploy ../frontend --project-name cemultix
```

### Routes admin

```
GET /admin/daily?key=ADMIN_KEY          → mot secret du jour
GET /admin/room/:code?key=ADMIN_KEY     → mot secret d'une salle
```

## Modèle sémantique

Les scores sont calculés à partir des embeddings **frWac** de [Jean-Philippe Fauconnier](https://fauconnier.github.io/#data), entraînés sur le corpus FrWaC. Le score reflète la similarité cosinus entre les vecteurs de deux mots — deux mots proches apparaissent fréquemment dans les mêmes contextes, pas nécessairement avec le même sens.

Le modèle n'est pas redistribué dans ce dépôt.

## Inspiré de
- [Cémantix](https://cemantix.certitudes.org) par Étienne Papegnies  
- [Semantle](https://gitlab.com/ebernstein/semantle) par Elliott Bernstein (GPLv3)

*Cémultix est une implémentation indépendante. Aucun code de ces projets n'a été réutilisé.*

## Licence

AGPL-3.0 — voir [LICENSE](LICENSE)
