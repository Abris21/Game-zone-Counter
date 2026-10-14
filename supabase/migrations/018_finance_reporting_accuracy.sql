-- Keep new expense records positive and representable as ETB to two decimals.
-- NOT VALID preserves existing historical rows while enforcing future writes.
-- Disable zero-value recurring templates created by older form validation; otherwise
-- one such template would reject the whole monthly posting transaction.
UPDATE recurring_expenses
SET is_active = false
WHERE amount <= 0;

UPDATE expenses
SET deleted_at = coalesce(deleted_at, now())
WHERE amount <= 0 AND deleted_at IS NULL;

ALTER TABLE expenses
  ADD CONSTRAINT expenses_positive_amount
  CHECK (amount > 0 AND amount <= 9999999999.99) NOT VALID;

ALTER TABLE recurring_expenses
  ADD CONSTRAINT recurring_expenses_positive_amount
  CHECK (amount > 0 AND amount <= 9999999999.99) NOT VALID;

-- Keep payment-method and daily P&L totals aligned with collected snack sales.
CREATE OR REPLACE FUNCTION profit_report(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  z uuid := my_zone();
  tz text;
  r jsonb;
BEGIN
  IF my_role() <> 'admin' THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 366 THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  SELECT timezone INTO tz FROM game_zones WHERE id = z;

  SELECT jsonb_build_object(
    -- Session revenue is returned separately from snack revenue for the UI summary.
    'revenue', coalesce((
      SELECT sum(total_amount)
      FROM sessions
      WHERE zone_id = z AND status = 'ended'
        AND (ended_at AT TIME ZONE tz)::date BETWEEN p_from AND p_to
    ), 0),
    'games', coalesce((
      SELECT sum(games_count)
      FROM sessions
      WHERE zone_id = z AND status = 'ended'
        AND (ended_at AT TIME ZONE tz)::date BETWEEN p_from AND p_to
    ), 0),
    'expenses', coalesce((
      SELECT sum(amount)
      FROM expenses
      WHERE zone_id = z AND deleted_at IS NULL AND expense_date BETWEEN p_from AND p_to
    ), 0),
    'by_method', coalesce((
      SELECT jsonb_object_agg(m, t)
      FROM (
        SELECT payment_method AS m, sum(amount) AS t
        FROM (
          SELECT payment_method, total_amount AS amount
          FROM sessions
          WHERE zone_id = z AND status = 'ended' AND payment_method IS NOT NULL
            AND (ended_at AT TIME ZONE tz)::date BETWEEN p_from AND p_to
          UNION ALL
          SELECT s.payment_method, sum(si.qty * si.unit_price_snapshot) AS amount
          FROM sales s
          JOIN sale_items si ON si.sale_id = s.id
          WHERE s.zone_id = z AND s.voided_at IS NULL AND s.payment_method IS NOT NULL
            AND (s.created_at AT TIME ZONE tz)::date BETWEEN p_from AND p_to
          GROUP BY s.id, s.payment_method
        ) collected
        GROUP BY payment_method
      ) methods
    ), '{}'::jsonb),
    'by_kind', coalesce((
      SELECT jsonb_object_agg(k, t)
      FROM (
        SELECT st.kind AS k, sum(s.total_amount) AS t
        FROM sessions s
        JOIN stations st ON st.id = s.station_id
        WHERE s.zone_id = z AND s.status = 'ended'
          AND (s.ended_at AT TIME ZONE tz)::date BETWEEN p_from AND p_to
        GROUP BY st.kind
      ) kinds
    ), '{}'::jsonb),
    'by_category', coalesce((
      SELECT jsonb_object_agg(c, t)
      FROM (
        SELECT category AS c, sum(amount) AS t
        FROM expenses
        WHERE zone_id = z AND deleted_at IS NULL AND expense_date BETWEEN p_from AND p_to
        GROUP BY category
      ) categories
    ), '{}'::jsonb),
    'daily', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'day', d,
          'game_revenue', game_revenue,
          'snack_revenue', snack_revenue,
          'snack_cost', snack_cost,
          'expenses', operating_expenses
        ) ORDER BY d
      )
      FROM (
        SELECT g::date AS d,
          coalesce((
            SELECT sum(total_amount)
            FROM sessions
            WHERE zone_id = z AND status = 'ended'
              AND (ended_at AT TIME ZONE tz)::date = g::date
          ), 0) AS game_revenue,
          coalesce((
            SELECT sum(si.qty * si.unit_price_snapshot)
            FROM sales s
            JOIN sale_items si ON si.sale_id = s.id
            WHERE s.zone_id = z AND s.voided_at IS NULL AND s.payment_method IS NOT NULL
              AND (s.created_at AT TIME ZONE tz)::date = g::date
          ), 0) AS snack_revenue,
          coalesce((
            SELECT sum(si.qty * si.unit_cost_snapshot)
            FROM sale_items si
            JOIN sales s ON s.id = si.sale_id
            WHERE s.zone_id = z AND s.voided_at IS NULL AND s.payment_method IS NOT NULL
              AND (s.created_at AT TIME ZONE tz)::date = g::date
          ), 0) AS snack_cost,
          coalesce((
            SELECT sum(amount)
            FROM expenses
            WHERE zone_id = z AND deleted_at IS NULL AND expense_date = g::date
          ), 0) AS operating_expenses
        FROM generate_series(p_from, p_to, interval '1 day') g
      ) daily_rows
    ), '[]'::jsonb)
  ) INTO r;

  RETURN r;
END;
$$;

GRANT EXECUTE ON FUNCTION profit_report(date, date) TO authenticated;
