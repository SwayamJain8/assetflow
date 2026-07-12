import { sql } from "drizzle-orm";

import { db } from "../../config/db";
import { env } from "../../config/env";
import type { Ctx } from "../../types";

const toNumbers = <T extends Record<string, unknown>>(rows: T[], keys: (keyof T)[]) =>
  rows.map((row) => {
    const copy = { ...row };
    for (const key of keys) copy[key] = Number(copy[key]) as T[keyof T];
    return copy;
  });

/**
 * Utilization by department — the bar chart.
 *
 * "Utilization" is the share of a department's assets that are actually in
 * someone's hands, rather than sitting in a cupboard. Counting only allocated /
 * total tells a manager whether they over-bought.
 */
export async function utilizationByDepartment(ctx: Ctx) {
  const result = await db.execute<{
    department: string;
    total: string;
    allocated: string;
    utilization: string;
  }>(sql`
    select
      coalesce(d.name, 'Unassigned')                                   as department,
      count(a.id)                                                      as total,
      count(*) filter (where a.status = 'allocated')                   as allocated,
      round(
        100.0 * count(*) filter (where a.status = 'allocated')
        / nullif(count(a.id), 0)                                       -- never divide by zero
      , 0)                                                             as utilization
    from assets a
    left join departments d on d.id = a.department_id
    where a.organization_id = ${ctx.orgId}
      and a.status not in ('disposed', 'retired')
    group by d.name
    order by count(a.id) desc
  `);

  return toNumbers(result.rows, ["total", "allocated", "utilization"]);
}

/**
 * Maintenance frequency — the line chart. Requests per month over the last 12,
 * plus a breakdown by category.
 *
 * generate_series is doing something important: a month with zero maintenance must
 * still appear, as a zero. A plain GROUP BY would omit it, and the line chart would
 * draw a straight segment across the gap as if nothing had changed.
 */
export async function maintenanceFrequency(ctx: Ctx) {
  const byMonth = await db.execute<{ month: string; requests: string }>(sql`
    with months as (
      select generate_series(
        date_trunc('month', current_date) - interval '11 months',
        date_trunc('month', current_date),
        interval '1 month'
      ) as month
    )
    select
      to_char(m.month, 'YYYY-MM')                                       as month,
      count(mr.id)                                                      as requests
    from months m
    left join maintenance_requests mr
      on date_trunc('month', mr.created_at) = m.month
     and mr.organization_id = ${ctx.orgId}
    group by m.month
    order by m.month
  `);

  const byCategory = await db.execute<{ category: string; requests: string }>(sql`
    select
      coalesce(c.name, 'Uncategorised')                                 as category,
      count(mr.id)                                                      as requests
    from maintenance_requests mr
    join assets a on a.id = mr.asset_id
    left join asset_categories c on c.id = a.category_id
    where mr.organization_id = ${ctx.orgId}
    group by c.name
    order by count(mr.id) desc
  `);

  return {
    byMonth: toNumbers(byMonth.rows, ["requests"]),
    byCategory: toNumbers(byCategory.rows, ["requests"]),
  };
}

/**
 * Most-used vs idle assets.
 *
 * "Used" counts both ways an asset can be in service — allocations AND bookings —
 * because a meeting room is never allocated and a laptop is never booked. Scoring
 * them by only one would rank every room as idle.
 */
export async function assetUsage(ctx: Ctx) {
  const mostUsed = await db.execute<{
    assetTag: string;
    name: string;
    allocations: string;
    bookings: string;
    uses: string;
  }>(sql`
    select
      a.asset_tag                                                       as "assetTag",
      a.name,
      (select count(*) from allocations al where al.asset_id = a.id)    as allocations,
      (select count(*) from bookings b
         where b.resource_id = a.id and b.status <> 'cancelled')        as bookings,
      (select count(*) from allocations al where al.asset_id = a.id)
        + (select count(*) from bookings b
             where b.resource_id = a.id and b.status <> 'cancelled')    as uses
    from assets a
    where a.organization_id = ${ctx.orgId}
      and a.status not in ('disposed', 'retired')
    order by uses desc, a.asset_tag
    limit 5
  `);

  /**
   * Idle = never used, or last used long ago. `last_used` coalesces the newest
   * allocation and the newest booking; an asset with neither has never moved since
   * it was registered, so we fall back to created_at — that IS how long it has sat.
   */
  const idle = await db.execute<{
    assetTag: string;
    name: string;
    idleDays: string;
    lastUsed: string | null;
  }>(sql`
    select
      a.asset_tag                                                       as "assetTag",
      a.name,
      greatest(0, (current_date - coalesce(last_used.at, a.created_at)::date))::int as "idleDays",
      last_used.at                                                      as "lastUsed"
    from assets a
    left join lateral (
      select max(at) as at from (
        select max(al.allocated_at) as at from allocations al where al.asset_id = a.id
        union all
        select max(b.starts_at)     as at from bookings b
          where b.resource_id = a.id and b.status <> 'cancelled'
      ) x
    ) last_used on true
    where a.organization_id = ${ctx.orgId}
      and a.status = 'available'
    order by "idleDays" desc
    limit 5
  `);

  return {
    mostUsed: toNumbers(mostUsed.rows, ["allocations", "bookings", "uses"]),
    idle: toNumbers(idle.rows, ["idleDays"]),
  };
}

/** Assets due for maintenance or nearing retirement. */
export async function attentionNeeded(ctx: Ctx) {
  const result = await db.execute<{
    assetTag: string;
    name: string;
    reason: string;
    days: string;
  }>(sql`
    -- Nearing retirement: a retirement date within 90 days.
    select
      a.asset_tag                                                       as "assetTag",
      a.name,
      'nearing_retirement'                                              as reason,
      (a.retirement_date - current_date)::int                           as days
    from assets a
    where a.organization_id = ${ctx.orgId}
      and a.retirement_date is not null
      and a.retirement_date <= current_date + interval '90 days'
      and a.status not in ('disposed', 'retired')

    union all

    -- Ageing: in poor condition, and old enough to be a real candidate.
    select
      a.asset_tag,
      a.name,
      'poor_condition'                                                  as reason,
      (current_date - a.acquisition_date)::int                          as days
    from assets a
    where a.organization_id = ${ctx.orgId}
      and a.condition in ('poor', 'damaged')
      and a.status not in ('disposed', 'retired', 'under_maintenance')

    order by days asc
    limit 10
  `);

  return toNumbers(result.rows, ["days"]);
}

/**
 * Booking heatmap — peak usage windows.
 *
 * A 7 × 24 grid of (day-of-week, hour) → booking count. `generate_series` over the
 * booking's own duration is the trick: a 09:00–12:00 booking must light up three
 * cells, not one. Counting by start hour alone would make a whole afternoon look
 * free because nothing happened to *begin* in it.
 */
export async function bookingHeatmap(ctx: Ctx) {
  /**
   * The hour and weekday are extracted in the ORGANIZATION'S timezone, not the
   * database's.
   *
   * `extract(hour from timestamptz)` uses the server's TimeZone setting, which in
   * a Docker container is UTC. A 09:00 IST booking would land in the "03:00"
   * column, and the heatmap would confidently report that this office holds its
   * meetings before dawn. `AT TIME ZONE` converts first, so the grid means what a
   * human sitting in the office would say.
   */
  const zone = env.APP_TIMEZONE;

  const result = await db.execute<{ dayOfWeek: string; hour: string; bookings: string }>(sql`
    select
      extract(dow  from (hours.hour AT TIME ZONE ${zone}))::int         as "dayOfWeek",
      extract(hour from (hours.hour AT TIME ZONE ${zone}))::int         as hour,
      count(*)                                                          as bookings
    from bookings b
    cross join lateral generate_series(
      date_trunc('hour', b.starts_at),
      b.ends_at - interval '1 second',
      interval '1 hour'
    ) as hours(hour)
    where b.organization_id = ${ctx.orgId}
      and b.status <> 'cancelled'
      and b.starts_at >= current_date - interval '90 days'
    group by 1, 2
    order by 1, 2
  `);

  return toNumbers(result.rows, ["dayOfWeek", "hour", "bookings"]);
}

/** Department-wise allocation summary. */
export async function allocationSummary(ctx: Ctx) {
  const result = await db.execute<{
    department: string;
    employees: string;
    assetsHeld: string;
    overdue: string;
  }>(sql`
    select
      coalesce(d.name, 'Unassigned')                                    as department,
      count(distinct u.id)                                              as employees,
      count(al.id) filter (where al.returned_at is null)                as "assetsHeld",
      count(al.id) filter (
        where al.returned_at is null
          and al.expected_return_date < current_date
      )                                                                 as overdue
    from departments d
    left join users u on u.department_id = d.id
    left join allocations al on al.holder_user_id = u.id
    where d.organization_id = ${ctx.orgId}
    group by d.name
    order by "assetsHeld" desc
  `);

  return toNumbers(result.rows, ["employees", "assetsHeld", "overdue"]);
}

/** Everything the Reports screen needs, in one call. */
export async function getReports(ctx: Ctx) {
  const [utilization, maintenance, usage, attention, heatmap, allocation] = await Promise.all([
    utilizationByDepartment(ctx),
    maintenanceFrequency(ctx),
    assetUsage(ctx),
    attentionNeeded(ctx),
    bookingHeatmap(ctx),
    allocationSummary(ctx),
  ]);

  return {
    utilizationByDepartment: utilization,
    maintenanceFrequency: maintenance,
    mostUsed: usage.mostUsed,
    idle: usage.idle,
    attentionNeeded: attention,
    bookingHeatmap: heatmap,
    allocationSummary: allocation,
  };
}
