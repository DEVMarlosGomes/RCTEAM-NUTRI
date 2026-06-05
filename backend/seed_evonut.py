#!/usr/bin/env python3
"""
RCTEAM-NUTRI — MongoDB Seed Script
Alimenta o banco com todos os dados extraídos da PLANILHA EVONUT

Usage:
    python3 seed_evonut.py --uri mongodb://localhost:27017 --db rcteam_nutri
"""
import json, argparse
from pymongo import MongoClient, UpdateOne

def seed(uri: str, db_name: str):
    client = MongoClient(uri)
    db = client[db_name]

    with open('evonut_database.json', 'r', encoding='utf-8') as f:
        data = json.load(f)

    # ── grupos_alimentares ─────────────────────────────────────
    if data.get('grupos_alimentares'):
        db.grupos_alimentares.delete_many({})
        db.grupos_alimentares.insert_many(data['grupos_alimentares'])
        print(f"  grupos_alimentares: {len(data['grupos_alimentares'])} registros")

    # ── medidas_caseiras ───────────────────────────────────────
    if data.get('medidas_caseiras'):
        db.medidas_caseiras.delete_many({})
        db.medidas_caseiras.insert_many(data['medidas_caseiras'])
        print(f"  medidas_caseiras: {len(data['medidas_caseiras'])} registros")

    # ── tmb_protocolos ─────────────────────────────────────────
    if data.get('tmb_protocolos'):
        db.tmb_protocolos.delete_many({})
        db.tmb_protocolos.insert_many(data['tmb_protocolos'])
        print(f"  tmb_protocolos: {len(data['tmb_protocolos'])} registros")

    # ── naf_opcoes ─────────────────────────────────────────────
    if data.get('naf_opcoes'):
        db.naf_opcoes.delete_many({})
        db.naf_opcoes.insert_many(data['naf_opcoes'])
        print(f"  naf_opcoes: {len(data['naf_opcoes'])} registros")

    # ── fatores_injuria ────────────────────────────────────────
    if data.get('fatores_injuria'):
        db.fatores_injuria.delete_many({})
        db.fatores_injuria.insert_many(data['fatores_injuria'])
        print(f"  fatores_injuria: {len(data['fatores_injuria'])} registros")

    # ── alimentos (upsert por id) ──────────────────────────────
    BATCH = 500
    alimentos = data.get('alimentos', [])
    if alimentos:
        # Garante que o id é sempre string para consistência com custom alimentos
        for a in alimentos:
            a['id'] = str(a['id'])
        ops = [UpdateOne({'id': a['id']}, {'$set': a}, upsert=True) for a in alimentos]
        for i in range(0, len(ops), BATCH):
            db.alimentos.bulk_write(ops[i:i+BATCH], ordered=False)
        db.alimentos.create_index('id', unique=True)
        db.alimentos.create_index('nome')
        db.alimentos.create_index('grupo')
        print(f"  alimentos: {len(alimentos)} registros (upsert + indexes)")

    print("\nSeed completo!")
    client.close()

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--uri',  default='mongodb://localhost:27017')
    p.add_argument('--db',   default='rcteam_nutri')
    args = p.parse_args()
    print(f"Conectando em {args.uri} -> {args.db}...")
    seed(args.uri, args.db)
