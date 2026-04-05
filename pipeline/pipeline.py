#!/usr/bin/env python3
"""
Cémantix Multi — Pipeline v9

Modèle : frWac_no_postag_no_phrase_500_skip_cut100.bin (229 Mo)
URL    : https://embeddings.net/embeddings/frWac_no_postag_no_phrase_500_skip_cut100.bin

Installe : py -3.11 -m pip install gensim tqdm

Usage : py -3.11 pipeline.py --model frWac.bin --secrets secrets.txt --out kv_data
"""
import argparse, json, sys, os
from pathlib import Path

try:
    from gensim.models import KeyedVectors
    from tqdm import tqdm
except ImportError:
    print("Lance : py -3.11 -m pip install gensim tqdm")
    sys.exit(1)

STOPWORDS = {
    'les','des','une','est','pas','par','sur','dans','avec','pour','que','qui',
    'son','ses','leur','leurs','mais','aux','plus','même','très','bien','tout',
    'cette','avoir','être','faire','dire','aller','voir','venir','aussi','dont',
    'car','donc','or','ni','ne','y','en','on','nous','vous','ils','elles',
    'fait','dit','était','sont','ont','été','ainsi','puis','comme','sans',
}


def load_model(path):
    cache = path + ".kv"
    if os.path.exists(cache):
        print("Cache trouvé, chargement rapide...")
        model = KeyedVectors.load(cache)
    else:
        print("Chargement du modèle (1-2 min)...")
        model = KeyedVectors.load_word2vec_format(path, binary=True, unicode_errors='ignore')
        print("Sauvegarde du cache...")
        model.save(cache)
    print(f"  {len(model)} mots, {model.vector_size}D")
    return model


def load_secrets(path):
    words = []
    with open(path, encoding='utf-8-sig') as f:
        for line in f:
            w = line.strip().lower().replace('\r', '')
            if w and not w.startswith('#') and 3 <= len(w) <= 25 and w not in STOPWORDS:
                words.append(w)
    words = list(dict.fromkeys(words))
    print(f"{len(words)} mots secrets chargés")
    return words


def compute(model, secrets, top_n):
    results, missing = {}, []
    for word in tqdm(secrets, desc="Calcul voisins"):
        if word not in model:
            missing.append(word)
            continue
        results[word] = [w for w, _ in model.most_similar(word, topn=top_n)]
    if missing:
        print(f"\n  ⚠ {len(missing)} mots absents du modèle :")
        for w in missing:
            print(f"    - {w}")
    return results


def save(results, model, out):
    out = Path(out)
    (out / 'bulk').mkdir(parents=True, exist_ok=True)

    secrets_list = list(results.keys())

    # ── secrets.json ─────────────────────────────────────────
    (out / 'secrets.json').write_text(
        json.dumps(secrets_list, ensure_ascii=False), encoding='utf-8')
    print(f"  secrets.json  : {len(secrets_list)} mots secrets")

    # ── wordlist.json — tous les mots du modèle filtrés ──────
    # Un seul fichier KV → un seul upload → validation rapide côté Worker
    wordlist = [
        w for w in model.index_to_key
        if 2 <= len(w) <= 30
        and not any(c.isdigit() for c in w)
        and not any(c.isupper() for c in w)
    ]
    (out / 'wordlist.json').write_text(
        json.dumps(wordlist, ensure_ascii=False), encoding='utf-8')
    print(f"  wordlist.json : {len(wordlist)} mots valides")

    # ── bulk des voisins ──────────────────────────────────────
    BATCH = 10_000
    items = list(results.items())
    n_bulk = 0
    for i in range(0, len(items), BATCH):
        batch = items[i:i+BATCH]
        entries = [
            {"key": f"neighbors:{w}", "value": json.dumps(nb, ensure_ascii=False)}
            for w, nb in batch
        ]
        (out / 'bulk' / f'bulk_{n_bulk}.json').write_text(
            json.dumps(entries), encoding='utf-8')
        print(f"  bulk_{n_bulk}.json  : {len(entries)} entrées")
        n_bulk += 1

    print(f"\n✓ Terminé → {out}/")
    print(f"\nUpload KV local (depuis worker/) :")
    print(f'  1. wrangler kv key put --local --binding=KV "secrets"  --path="..\pipeline\{out.name}\secrets.json"')
    print(f'  2. wrangler kv key put --local --binding=KV "wordlist" --path="..\pipeline\{out.name}\wordlist.json"')
    print(f'  3. $dir="..\pipeline\{out.name}\\bulk"')
    print(f'     Get-ChildItem $dir -Filter "bulk_*.json" | ForEach-Object {{')
    print(f'         wrangler kv bulk put --local --binding=KV $_.FullName')
    print(f'     }}')
    print(f'  4. Mot du jour :')
    print(f'     $d=(Get-Date -Format "yyyy-MM-dd")')
    print(f'     wrangler kv key put --local --binding=KV "daily:$d" (\'{{\"word\":\"maison\",\"date\":\"\'+$d+\'\",\"number\":1}}\')')


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--model',   required=True)
    p.add_argument('--secrets', required=True)
    p.add_argument('--out',     default='kv_data')
    p.add_argument('--top-n',   type=int, default=10000)
    args = p.parse_args()

    if not os.path.exists(args.model):
        print(f"Modèle introuvable : {args.model}")
        print("Télécharge : curl -L https://embeddings.net/embeddings/frWac_no_postag_no_phrase_500_skip_cut100.bin -o frWac.bin")
        sys.exit(1)

    model   = load_model(args.model)
    secrets = load_secrets(args.secrets)
    results = compute(model, secrets, args.top_n)
    save(results, model, args.out)


if __name__ == '__main__':
    main()