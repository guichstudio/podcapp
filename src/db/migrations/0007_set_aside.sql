-- "Mettre de côté": the source stays in the library but leaves the open stories,
-- so it cannot be counted, selected or aired. Nothing in the editorial path
-- changes -- an unclustered source is a shape it already handles -- and the row
-- keeps its extraction, analysis and embedding, which is what makes putting it
-- back cheap.
ALTER TABLE sources ADD COLUMN IF NOT EXISTS set_aside_at timestamptz;
