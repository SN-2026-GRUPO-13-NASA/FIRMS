import os
import sys
import csv
import io
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from supabase import create_client, Client

# Credenciais lidas dos Secrets do GitHub Actions
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
FIRMS_MAP_KEY = os.environ.get("NASA_API_KEY")

if not all([SUPABASE_URL, SUPABASE_KEY, FIRMS_MAP_KEY]):
    print("Erro: Variáveis de ambiente (SUPABASE_URL, SUPABASE_SERVICE_KEY, NASA_API_KEY) não foram configuradas.")
    sys.exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def create_http_session():
    """Cria uma sessão HTTP com User-Agent customizado e politica de retentativas"""
    session = requests.Session()
    session.headers.update({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    })
    
    # Configura retentativas automáticas em falhas de conexão/rede
    retries = Retry(
        total=4,
        backoff_factor=2, # Espera 2s, 4s, 8s entre tentativas
        status_forcelist=[500, 502, 503, 504],
        raise_on_status=False
    )
    adapter = HTTPAdapter(max_retries=retries)
    session.mount('https://', adapter)
    session.mount('http://', adapter)
    return session

def run_pipeline():
    status = "concluido"
    erros = None
    total_registros = 0
    total_lotes = 0

    try:
        # Consulta por área (América do Sul / Brasil: BBOX -74,-34,-34,5)
        bbox = "-74,-34,-34,5"
        source = "VIIRS_SNPP_NRT"
        day_range = "1"

        url = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{FIRMS_MAP_KEY}/{source}/{bbox}/{day_range}"
        
        print("Consultando API NASA FIRMS...")
        session = create_http_session()
        response = session.get(url, timeout=60)

        if response.status_code != 200:
            raise Exception(f"Erro no endpoint NASA FIRMS: Status {response.status_code} - {response.text}")

        csv_data = response.text.strip()
        if not csv_data or "latitude" not in csv_data:
            print("Nenhum registro retornado do FIRMS para esta região/período.")
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

        print(f"Total de registros obtidos: {total_registros}")

        if total_registros > 0:
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
        print(f"Falha durante execução do pipeline: {erros}")

    # Registro do log na tabela 'execucoes' do Supabase
    try:
        supabase.table("execucoes").insert({
            "registros_processados": total_registros,
            "lotes": total_lotes,
            "erros": erros,
            "status": status
        }).execute()
        print(f"Execução finalizada e gravada com status: {status}")
    except Exception as log_err:
        print(f"Erro ao salvar log no Supabase: {log_err}")

    if status == "erro_critico":
        sys.exit(1)

if __name__ == "__main__":
    run_pipeline()