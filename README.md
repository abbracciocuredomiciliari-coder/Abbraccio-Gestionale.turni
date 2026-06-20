# OPBGestionale

Gestionale turni per la lavorazione dei turni del personale.

## Funzionalità principali

- Gestione personale con ruoli e limitazioni
- Inserimento richieste (ferie, desiderate, limitazioni) da parte del personale
- Approvazione richieste da parte del coordinatore
- Algoritmo di distribuzione equa dei turni mensili
- Planning turni mensile con calendario
- Notifiche di stato richieste

## Stack tecnologico

- **Backend**: Node.js + Express
- **Frontend**: React
- **Database**: PostgreSQL

## Struttura del progetto

```
OPBGgestionale/
├── backend/       # API REST Node.js/Express
├── frontend/      # Applicazione React
├── database/      # Script SQL per schema e dati
└── README.md
```

## Installazione

### Backend

```bash
cd backend
npm install
npm run dev
```

### Frontend

```bash
cd frontend
npm install
npm start
```

## Configurazione

Copiare `.env.example` in `.env` e configurare i parametri del database PostgreSQL.

## Licenza

Proprietario
