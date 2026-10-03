import os
import sys
import csv
import io
import requests
from supabase import create_client, Client

# Leitura das credenciais via Secrets do GitHub
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
FIRMS_MAP_KEY = os.environ.get("NASA_API_KEY")

if not all([SUPABASE_URL, SUPABASE_KEY, FIRMS_MAP_KEY]):
    print("Erro: Variáveis de ambiente faltando.")
    sys.exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def run_pipeline():
    status = "concluido"
    erros = None
    total_registros = 0
    total_lotes = 0

    try:
        # Consulta por área (BBOX América do Sul/Brasil)
        bbox = "-74,-34,-34,5"
        source = "VIIRS_SNPP_NRT"
        day_range = "1"

        url = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{FIRMS_MAP_KEY}/{source}/{bbox}/{day_range}"
        
        response = requests.get(url, timeout=45)
        if response.status_code != 200:
            raise Exception(f"Erro na API FIRMS: Status {response.status_code} - {response.text}")

        csv_data = response.text.strip()
        if not csv_data or "latitude" not in csv_data:
            print("Nenhum dado retornado do FIRMS.")
            records = []
        else:
            reader = csv.DictReader(io.StringIO(csv_data))
            records = []
            seen_keys = set()

            for row in reader:
                dedup_key = (
                    row.get('latitude'),
                    row.get('longitude'),
                    row.get('acq_date'),
                    row.get('acq_time'),
                    row.get('satellite', 'VIIRS')
                )

                if dedup_key in seen_keys:
                    continue
                seen_keys.add(dedup_key)

                item = {
                    "latitude": float(row['latitude']),
                    "longitude": float(row['longitude']),
                    "brightness": float(row['bright_ti4']) if row.get('bright_ti4') else None,
                    "scan": float(row['scan']) if row.get('scan') else None,
                    "track": float(row['track']) if row.get('track') else None,
                    "acq_date": row['acq_date'],
                    "acq_time": row['acq_time'],
                    "satellite": row.get('satellite', 'VIIRS'),
                    "confidence": row.get('confidence'),
                    "version": row.get('version'),
                    "bright_t31": float(row['bright_ti5']) if row.get('bright_ti5') else None,
                    "frp": float(row['frp']) if row.get('frp') else None,
                    "daynight": row.get('daynight')
                }
                records.append(item)

        total_registros = len(records)
        batch_size = 100

        # Upsert em lotes para evitar duplicidade
        for i in range(0, total_registros, batch_size):
            batch = records[i:i + batch_size]
            supabase.table("firms_data").upsert(
                batch,
                on_conflict="latitude,longitude,acq_date,acq_time,satellite"
            ).execute()
            total_lotes += 1

    except Exception as e:
        status = "erro_critico"
        erros = str(e)
        print(f"Erro na execução: {erros}")

    # Registro na tabela de logs 'execucoes'
    try:
        supabase.table("execucoes").insert({
            "registros_processados": total_registros,
            "lotes": total_lotes,
            "erros": erros,
            "status": status
        }).execute()
    except Exception as log_err:
        print(f"Erro ao gravar log: {log_err}")

    if status == "erro_critico":
        sys.exit(1)

if __name__ == "__main__":
    run_pipeline()