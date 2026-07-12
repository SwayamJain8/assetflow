"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Boxes, Plus, ScanLine, Search, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";

import { AssetDrawer } from "@/components/asset-drawer";
import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { DataTable, EmptyState } from "@/components/ui/data-table";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { StatusPill } from "@/components/ui/status-pill";
import { useCan } from "@/context/auth";
import { ApiError, get, post } from "@/lib/api";
import type { Asset, Category, Department } from "@/lib/types";
import { cn, formatCurrency, humanize } from "@/lib/utils";

const STATUSES = [
  "available",
  "allocated",
  "reserved",
  "under_maintenance",
  "lost",
  "retired",
  "disposed",
] as const;

function AssetsScreen() {
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const { manageAssets } = useCan();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [selected, setSelected] = useState<Asset | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formCategoryId, setFormCategoryId] = useState("");

  // Deep links from the dashboard's KPI cards and quick actions.
  useEffect(() => {
    const initialStatus = params.get("status");
    if (initialStatus) setStatus(initialStatus);
    if (params.get("new") === "1") setIsRegistering(true);
  }, [params]);

  const query = new URLSearchParams();
  if (search) query.set("q", search);
  if (status) query.set("status", status);
  if (categoryId) query.set("categoryId", categoryId);
  if (departmentId) query.set("departmentId", departmentId);

  const { data: assets = [], isLoading } = useQuery({
    queryKey: ["assets", query.toString()],
    queryFn: () => get<Asset[]>(`/assets?${query.toString()}`),
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: () => get<Category[]>("/categories"),
  });

  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: () => get<Department[]>("/departments"),
  });

  const register = useMutation({
    mutationFn: (input: Record<string, unknown>) => post<Asset>("/assets", input),
    onSuccess: (asset) => {
      void queryClient.invalidateQueries({ queryKey: ["assets"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });

      // The tag is minted by a Postgres sequence, so it is only knowable after
      // the insert — show it, because it is the thing the user will search by.
      toast.success(`${asset.assetTag} registered`, {
        description: `${asset.name} is now Available.`,
      });

      setIsRegistering(false);
      setErrors({});
      setFormCategoryId("");
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        setErrors(error.fieldErrors);
        if (!Object.keys(error.fieldErrors).length) toast.error(error.message);
      }
    },
  });

  const activeFilters = [status, categoryId, departmentId].filter(Boolean).length;

  // The category chosen in the REGISTER form decides which extra fields appear.
  const formCategory = categories.find((category) => category.id === formCategoryId);

  const columns: ColumnDef<Asset, unknown>[] = [
    {
      accessorKey: "assetTag",
      header: "Tag",
      cell: ({ row }) => (
        <span className="nums font-mono text-xs font-medium text-primary">
          {row.original.assetTag}
        </span>
      ),
    },
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.original.name}</p>
          {row.original.serialNumber && (
            <p className="truncate font-mono text-[10px] text-subtle">
              {row.original.serialNumber}
            </p>
          )}
        </div>
      ),
    },
    {
      accessorKey: "categoryName",
      header: "Category",
      cell: ({ row }) => (
        <span className="text-muted">{row.original.categoryName ?? "—"}</span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <StatusPill status={row.original.status} />,
    },
    {
      id: "holder",
      header: "Held by",
      cell: ({ row }) =>
        row.original.holderName ? (
          <span className="text-fg">{row.original.holderName}</span>
        ) : (
          <span className="text-subtle">—</span>
        ),
    },
    {
      accessorKey: "location",
      header: "Location",
      cell: ({ row }) => (
        <span className="text-muted">{row.original.location ?? "—"}</span>
      ),
    },
    {
      accessorKey: "acquisitionCost",
      header: "Cost",
      cell: ({ row }) => (
        <span className="nums text-xs text-muted">
          {formatCurrency(row.original.acquisitionCost)}
        </span>
      ),
    },
  ];

  return (
    <PageShell
      title="Assets"
      subtitle={`${assets.length} asset${assets.length === 1 ? "" : "s"}`}
      actions={
        manageAssets && (
          <Button size="sm" onClick={() => setIsRegistering(true)}>
            <Plus className="size-4" />
            Register Asset
          </Button>
        )
      }
    >
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />

          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by tag, serial, or QR code…"
            className="pl-9"
          />

          {/*
           * A QR scanner is a keyboard: it types the tag it read. So a scan lands
           * in this very box and the tag match handles it — there is no separate
           * QR lookup path to build or keep in sync.
           */}
          <span className="absolute top-1/2 right-3 flex -translate-y-1/2 items-center gap-1 text-[10px] text-subtle">
            <ScanLine className="size-3" />
            scan-ready
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className={cn("h-8 w-44 text-xs", status && "border-primary/40 text-fg")}
          >
            <option value="">All statuses</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {humanize(value)}
              </option>
            ))}
          </Select>

          <Select
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            className={cn("h-8 w-40 text-xs", categoryId && "border-primary/40 text-fg")}
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>

          <Select
            value={departmentId}
            onChange={(event) => setDepartmentId(event.target.value)}
            className={cn("h-8 w-44 text-xs", departmentId && "border-primary/40 text-fg")}
          >
            <option value="">All departments</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </Select>

          {activeFilters > 0 && (
            <button
              onClick={() => {
                setStatus("");
                setCategoryId("");
                setDepartmentId("");
              }}
              className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-line bg-surface-2 px-2.5 py-1 text-xs text-muted transition-colors hover:text-fg"
            >
              <X className="size-3" />
              Clear {activeFilters} filter{activeFilters === 1 ? "" : "s"}
            </button>
          )}
        </div>

        <DataTable
          data={assets}
          columns={columns}
          isLoading={isLoading}
          onRowClick={setSelected}
          empty={
            <EmptyState
              title={search || activeFilters ? "No assets match" : "No assets yet"}
              description={
                search || activeFilters
                  ? "Try a different search or clear the filters."
                  : "Register your first asset — the tag is generated for you."
              }
              icon={Boxes}
              action={
                manageAssets && !search && !activeFilters ? (
                  <Button size="sm" onClick={() => setIsRegistering(true)}>
                    <Plus className="size-4" />
                    Register Asset
                  </Button>
                ) : undefined
              }
            />
          }
        />
      </div>

      <AssetDrawer asset={selected} onClose={() => setSelected(null)} canManage={manageAssets} />

      <Modal
        open={isRegistering}
        onClose={() => {
          setIsRegistering(false);
          setErrors({});
          setFormCategoryId("");
        }}
        title="Register asset"
        description="The asset tag is generated by the database — you cannot pick one, and two people registering at once cannot collide."
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsRegistering(false)}>
              Cancel
            </Button>
            <Button form="asset-form" type="submit" loading={register.isPending}>
              Register
            </Button>
          </>
        }
      >
        <form
          id="asset-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setErrors({});

            const data = new FormData(event.currentTarget);
            const cost = data.get("acquisitionCost");

            // Only the fields this category actually declares.
            const customValues: Record<string, string | number> = {};
            for (const field of formCategory?.customFields ?? []) {
              const value = data.get(`custom.${field.key}`);
              if (value) {
                customValues[field.key] =
                  field.type === "number" ? Number(value) : String(value);
              }
            }

            register.mutate({
              name: data.get("name"),
              categoryId: data.get("categoryId") || null,
              departmentId: data.get("departmentId") || null,
              serialNumber: data.get("serialNumber") || null,
              acquisitionDate: data.get("acquisitionDate") || null,
              acquisitionCost: cost ? Number(cost) : null,
              condition: data.get("condition"),
              location: data.get("location") || null,
              isBookable: data.get("isBookable") === "on",
              customValues,
            });
          }}
          className="grid grid-cols-2 gap-3.5"
        >
          <Field label="Name" error={errors.name} required className="col-span-2">
            <Input
              name="name"
              placeholder="MacBook Pro 14"
              invalid={Boolean(errors.name)}
              autoFocus
            />
          </Field>

          <Field label="Category" error={errors.categoryId}>
            <Select
              name="categoryId"
              value={formCategoryId}
              onChange={(event) => setFormCategoryId(event.target.value)}
            >
              <option value="">Uncategorised</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Department" error={errors.departmentId}>
            <Select name="departmentId">
              <option value="">Unassigned</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Serial number" error={errors.serialNumber}>
            <Input name="serialNumber" placeholder="C02XY1114" />
          </Field>

          <Field label="Location" error={errors.location}>
            <Input name="location" placeholder="Bengaluru" />
          </Field>

          <Field label="Acquisition date" error={errors.acquisitionDate}>
            <Input name="acquisitionDate" type="date" invalid={Boolean(errors.acquisitionDate)} />
          </Field>

          <Field
            label="Acquisition cost"
            error={errors.acquisitionCost}
            hint="For reports only — AssetFlow does no accounting."
          >
            <Input
              name="acquisitionCost"
              type="number"
              min="0"
              step="1"
              placeholder="185000"
              invalid={Boolean(errors.acquisitionCost)}
            />
          </Field>

          <Field label="Condition">
            <Select name="condition" defaultValue="good">
              {["new", "good", "fair", "poor", "damaged"].map((value) => (
                <option key={value} value={value}>
                  {humanize(value)}
                </option>
              ))}
            </Select>
          </Field>

          <div className="col-span-2 flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
            <input
              type="checkbox"
              name="isBookable"
              id="isBookable"
              className="size-3.5 accent-[var(--brand-500)]"
            />
            <label htmlFor="isBookable" className="cursor-pointer text-xs text-fg">
              This is a <span className="font-medium">shared bookable resource</span> (a room, a
              vehicle)
            </label>
          </div>

          {/*
           * The category's own fields, rendered from its jsonb definition. This is
           * what "Electronics wants a warranty period, Furniture does not" means in
           * practice — and why there is no table per category.
           */}
          {formCategory && formCategory.customFields.length > 0 && (
            <div className="col-span-2">
              <p className="mb-2 text-[11px] font-medium text-muted">
                {formCategory.name} fields
              </p>

              <div className="grid grid-cols-2 gap-3 rounded-lg border border-line bg-surface-2 p-3">
                {formCategory.customFields.map((field) => (
                  <Field key={field.key} label={field.label}>
                    <Input
                      name={`custom.${field.key}`}
                      type={field.type === "number" ? "number" : field.type}
                      placeholder={field.type === "number" ? "24" : ""}
                    />
                  </Field>
                ))}
              </div>
            </div>
          )}
        </form>
      </Modal>
    </PageShell>
  );
}

export default function AssetsPage() {
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense fallback={null}>
      <AssetsScreen />
    </Suspense>
  );
}
