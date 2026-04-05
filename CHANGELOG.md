# Changelog

## 2026-04-05

### Interface et responsive
- Lobby recentré et mieux proportionné sur grand écran.
- Formulaires multijoueur:
- Desktop: Créer/Rejoindre côte à côte avec "ou" au centre.
- Mobile: boites empilées, sans débordement horizontal.
- Sélecteur de modes mobile ajusté: Course + Coop en haut, Solo centré dessous.
- Lien Crédits passé en blanc.
- Le séparateur "ou" est visible sur mobile et desktop.

### UX des formulaires
- Ajout d'un switch Course: "Voir les mots des autres joueurs" (off par défaut).
- Switch restylé:
- OFF gris, ON jaune.
- Taille réduite et alignée avec le texte.
- Coins plus arrondis.
- Le texte du switch a été harmonisé (taille/couleur).
- En desktop, la boite Rejoindre garde sa hauteur naturelle et reste centrée verticalement face à Créer.
- Ajustements de placeholders pendant l'itération UI.

### Gameplay multijoueur
- Quand un joueur trouve le mot, popup de victoire affichée chez tous les joueurs.
- En Course, le mot gagnant s'affiche comme "Trouvé" pour tous (plus de "Très proche 100%" côté autres joueurs).
- Correction du spam de notification de victoire (événement affiché une seule fois).
- Messages de fin en français:
- Course: gagnant + temps au format mm:ss:mmm.
- Coop: total d'essais équipe.
- Coop conserve son comportement sans switch de visibilité.

### Backend (Worker / Durable Object)
- Ajout du paramètre showOtherWords au niveau salle (Course uniquement), transmis API -> DO.
- Payload /state adapté par joueur:
- showOtherWords=false: les autres mots sont masqués (longueur + score/proximité uniquement).
- showOtherWords=true: comportement normal (mots visibles).
- Ajout d'un winnerEvent dans l'état de salle: winner, word, timestamp, durationMs, totalGuesses, mode.
- Déduplication des événements gagnants côté frontend avec timestamp pour éviter les doublons de polling.

### Popup de fin
- Bouton Partager supprimé.
- Bouton Continuer renommé en Fermer.

### Confidentialité et mentions légales
- Ajout d'un lien footer "Confidentialité" avant "Crédits".
- Ajout d'une modal "Confidentialité & Mentions légales" avec sections:
- Éditeur
- Données collectées
- Cloudflare
- Analytics
- Pseudonymes
- Scores
- Open source
- Contact

### Liens d'invitation
- Si un utilisateur arrive via /?room=XXXX:
- le code est prérempli automatiquement dans la boite de code de salle.
- puis le paramètre ?room= est retiré de l'URL via history.replaceState.
- le code reste bien présent dans la textbox.

### Fichiers impactés
- frontend/index.html
- worker/src/index.js
- worker/src/room.js
- CHANGELOG.md

### Validation
- Vérifications d'erreurs effectuées après modifications sur les fichiers touchés (aucune erreur signalée).