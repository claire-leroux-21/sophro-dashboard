# Sophro Dashboard

Dashboard personnel de Claire Leroux — sync bidirectionnelle avec Notion.

## Stack
- Frontend: React via CDN + HTML statique
- Backend: Netlify Functions (Node.js)
- Base de données: Notion API

## Déploiement
Connecté à Netlify. Chaque push sur `main` redéploie automatiquement.

## Variables d'environnement requises (à configurer dans Netlify)
- `NOTION_TOKEN` : clé secrète de l'intégration Notion
- `NOTION_DATA_SOURCE_ID` : `0d6410e0-cc44-4150-a6e8-c33350bb7773`
