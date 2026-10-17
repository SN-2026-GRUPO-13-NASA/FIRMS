import os
import sys
import csv
import io
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from supabase import create_client, Client

# ---------------------------------------------------------------------------
# CREDENCIAIS E VARIÁVEIS DE AMBIENTE
# ---------------------------------------------------------------------------
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
FIRMS_MAP_KEY = os.environ.get("NASA_API_KEY")

if not all([SUPABASE_URL, SUPABASE_KEY, FIRMS_MAP_KEY]):
    print("Erro: As variáveis de ambiente (SUPABASE_URL, SUPABASE_SERVICE_KEY, NASA_API_KEY) não estão configuradas.")
    sys.exit(1)

# Inicialização do cliente Supabase
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


# ---------------------------------------------------------------------------
# FUNÇÕES AUXILIARES
# ---------------------------------------------------------------------------
def safe_float(val):
    """
    Converte um valor recebido para float de forma segura.
    Evita que erros de conversão interrompam a execução do pipeline.
    """
    try:
        return float(val) if val is not None and str(val).strip() != '' else None
    except (ValueError, TypeError):
        return None


def create_http_session():
    """
    Cria uma sessão HTTP com User-Agent personalizado e política de retentativas.
    Previne falhas temporárias de rede ao ligar à API da NASA.
    """
    session = requests.Session()
    session.headers.update({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    })
    
    # Configuração de retentativas automáticas (2s, 4s, 8s de intervalo)
    retries = Retry(
        total=4,
        backoff_factor=2,
        status_forcelist=[500, 502, 503, 504],
        raise_on_status=False
    )
    adapter = HTTPAdapter(max_retries=retries)
    session.mount('https://', adapter)
    session.mount('http://', adapter)
    return session


# ---------------------------------------------------------------------------
# PIPELINE PRINCIPAL DE INGESTÃO
# ---------------------------------------------------------------------------
def run_pipeline():
    status = "concluido"
    erros = None
    total_registros = 0
    total_lotes = 0

    try:
        # Bounding Box cobrindo a América do Sul / Brasil (-74,-34,-34,5)
        bbox = "-74,-34,-34,5"
        source = "VIIRS_SNPP_NRT"
        day_range = "1"

        url = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{FIRMS_MAP_KEY}/{source}/{bbox}/{day_range}"
        
        print("A consultar a API NASA FIRMS...")
        session = create_http_session()
        response = session.get(url, timeout=60)

        if response.status_code != 200:
            raise Exception(f"Erro no endpoint NASA FIRMS: Status {response.status_code} - {response.text}")

        csv_data = response.text.strip()
        if not csv_data or "latitude" not in csv_data:
            print("Nenhum registo retornado da NASA FIRMS para esta região/período.")
            records = []
        else:
            reader = csv.DictReader(io.StringIO(csv_data))
            records = []
            seen_keys = set()

            for row in reader:
                # Chave única para evitar duplicados no mesmo ficheiro CSV
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
                    "latitude": safe_float(row.get('latitude')),
                    "longitude": safe_float(row.get('longitude')),
                    "brightness": safe_float(row.get('bright_ti4')),
                    "scan": safe_float(row.get('scan')),
                    "track": safe_float(row.get('track')),
                    "acq_date": row.get('acq_date'),
                    "acq_time": row.get('acq_time'),
                    "satellite": row.get('satellite', 'VIIRS'),
                    "confidence": row.get('confidence'),
                    "version": row.get('version'),
                    "bright_t31": safe_float(row.get('bright_ti5')),
                    "frp": safe_float(row.get('frp')),
                    "daynight": row.get('daynight')
                }
                records.append(item)

        total_registros = len(records)
        batch_size = 100

        print(f"Total de registos obtidos: {total_registros}")

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
        print(f"Falha durante a execução do pipeline: {erros}")

    # Registo de log na tabela 'execucoes' do Supabase
    try:
        supabase.table("execucoes").insert({
            "registros_processados": total_registros,
            "lotes": total_lotes,
            "erros": erros,
            "status": status
        }).execute()
        print(f"Execução finalizada e gravada com status: {status}")
    except Exception as log_err:
        print(f"Erro ao guardar o log no Supabase: {log_err}")

    if status == "erro_critico":
        sys.exit(1)


if __name__ == "__main__":
    run_pipeline()