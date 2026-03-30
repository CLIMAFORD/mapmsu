-- Create a view that exposes building attributes and aggregates related images from `bld_images`.
-- This view matches on `new_bld_id` when available, otherwise falls back to matching building names.
CREATE OR REPLACE VIEW public.view_buildings AS
SELECT
	b.id AS source_id,
	(b.properties->> 'Name') AS name,
	(b.properties->> 'location') AS location,
	(b.properties->> 'Category') AS category,
	(b.properties->> 'new_bld_id') AS new_bld_id,
	b.geom,
	-- aggregate exterior/interior image URLs (remove empty strings and NULLs)
	array_remove(array_agg(DISTINCT NULLIF(trim(bi.exterior_image_url), '')), NULL) AS exterior_images,
	array_remove(array_agg(DISTINCT NULLIF(trim(bi.interior_image_url), '')), NULL) AS interior_images
FROM public.buildings_11 b
LEFT JOIN public.bld_images bi
	ON (
		bi.new_bld_id IS NOT NULL
		AND bi.new_bld_id = (b.properties->> 'new_bld_id')
	)
	OR (
		bi.building_name IS NOT NULL
		AND lower(bi.building_name) = lower(b.properties->> 'Name')
	)
GROUP BY
	b.id,
	(b.properties->> 'Name'),
	(b.properties->> 'location'),
	(b.properties->> 'Category'),
	(b.properties->> 'new_bld_id'),
	b.geom;

-- Helpful quick-check queries (uncomment to run in Supabase SQL editor)
-- SELECT count(*) FROM public.view_buildings;
-- SELECT * FROM public.view_buildings LIMIT 20;