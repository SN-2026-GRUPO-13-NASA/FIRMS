-- 1. Tabela Principal (Dados do FIRMS)
CREATE TABLE IF NOT EXISTS public.firms_data (
    id BIGSERIAL PRIMARY KEY,
    latitude FLOAT NOT NULL,
    longitude FLOAT NOT NULL,
    brightness FLOAT,
    scan FLOAT,
    track FLOAT,
    acq_date DATE NOT NULL,
    acq_time VARCHAR(10) NOT NULL,
    satellite VARCHAR(20),
    confidence VARCHAR(10),
    version VARCHAR(20),
    bright_t31 FLOAT,
    frp FLOAT,
    daynight VARCHAR(5),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT unique_fire_event UNIQUE (latitude, longitude, acq_date, acq_time, satellite)
);

-- 2. Tabela de Log de Execuções
CREATE TABLE IF NOT EXISTS public.execucoes (
    id BIGSERIAL PRIMARY KEY,
    data_execucao TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    registros_processados INT DEFAULT 0,
    lotes INT DEFAULT 0,
    erros TEXT,
    status VARCHAR(20) CHECK (status IN ('concluido', 'erro_parcial', 'erro_critico')) NOT NULL
);

-- 3. Habilitar RLS
ALTER TABLE public.firms_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.execucoes ENABLE ROW LEVEL SECURITY;

-- 4. Políticas RLS de Leitura Pública
CREATE POLICY "Permitir leitura publica em firms_data" 
ON public.firms_data FOR SELECT USING (true);

CREATE POLICY "Permitir leitura publica em execucoes" 
ON public.execucoes FOR SELECT USING (true);

-- 5. Aplicação dos GRANTS
GRANT SELECT ON public.firms_data TO anon, authenticated;
GRANT SELECT ON public.execucoes TO anon, authenticated;

GRANT ALL ON public.firms_data TO service_role;
GRANT ALL ON public.execucoes TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;