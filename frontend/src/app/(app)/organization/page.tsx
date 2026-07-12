"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Building2, Plus, ShieldCheck, Tags, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { DataTable, EmptyState } from "@/components/ui/data-table";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { StatusPill } from "@/components/ui/status-pill";
import { useAuth } from "@/context/auth";
import { ApiError, del, get, patch, post } from "@/lib/api";
import type { Category, CustomField, Department, Employee, Role } from "@/lib/types";
import { cn, ROLE_LABEL } from "@/lib/utils";

type Tab = "departments" | "categories" | "employees";

const TABS: { id: Tab; label: string; icon: typeof Building2 }[] = [
  { id: "departments", label: "Departments", icon: Building2 },
  { id: "categories", label: "Categories", icon: Tags },
  { id: "employees", label: "Employee", icon: Users },
];

export default function OrganizationPage() {
  const [tab, setTab] = useState<Tab>("departments");
  const [isAdding, setIsAdding] = useState(false);

  return (
    <PageShell
      title="Organization setup"
      subtitle="The master data everything else depends on"
      actions={
        tab !== "employees" && (
          <Button size="sm" onClick={() => setIsAdding(true)}>
            <Plus className="size-4" />
            Add
          </Button>
        )
      }
    >
      <div className="space-y-4">
        <div className="flex gap-1.5">
          {TABS.map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all",
                tab === item.id
                  ? "border-primary/40 bg-primary/12 text-fg"
                  : "border-line bg-surface-2 text-muted hover:border-line-strong hover:text-fg",
              )}
            >
              <item.icon className="size-3.5" />
              {item.label}
            </button>
          ))}
        </div>

        {tab === "departments" && (
          <DepartmentsTab isAdding={isAdding} onClose={() => setIsAdding(false)} />
        )}
        {tab === "categories" && (
          <CategoriesTab isAdding={isAdding} onClose={() => setIsAdding(false)} />
        )}
        {tab === "employees" && <EmployeesTab />}

        <p className="text-xs text-subtle">
          Editing a department or category here drives the pickers on the Assets and Allocation
          screens.
        </p>
      </div>
    </PageShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Departments
// ─────────────────────────────────────────────────────────────────────────────

function DepartmentsTab({ isAdding, onClose }: { isAdding: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Department | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data = [], isLoading } = useQuery({
    queryKey: ["departments"],
    queryFn: () => get<Department[]>("/departments"),
  });

  const { data: employees = [] } = useQuery({
    queryKey: ["users"],
    queryFn: () => get<Employee[]>("/users"),
  });

  const open = isAdding || Boolean(editing);

  const close = () => {
    setEditing(null);
    setErrors({});
    onClose();
  };

  const save = useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      editing ? patch(`/departments/${editing.id}`, input) : post("/departments", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["departments"] });
      toast.success(editing ? "Department updated" : "Department created");
      close();
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        setErrors(error.fieldErrors);
        if (!Object.keys(error.fieldErrors).length) toast.error(error.message);
      }
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => del(`/departments/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["departments"] });
      toast.success("Department deleted");
    },
    // The API refuses to orphan employees and assets, and says exactly why.
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Failed"),
  });

  const columns: ColumnDef<Department, unknown>[] = [
    {
      accessorKey: "name",
      header: "Department",
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
    },
    {
      accessorKey: "headName",
      header: "Head",
      cell: ({ row }) => row.original.headName ?? <span className="text-subtle">—</span>,
    },
    {
      accessorKey: "parentName",
      header: "Parent Dept",
      cell: ({ row }) =>
        row.original.parentName ? (
          <span className="text-muted">{row.original.parentName}</span>
        ) : (
          <span className="text-subtle">—</span>
        ),
    },
    {
      id: "size",
      header: "Size",
      cell: ({ row }) => (
        <span className="nums text-xs text-muted">
          {row.original.memberCount} people · {row.original.assetCount} assets
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <StatusPill status={row.original.status} />,
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <button
          onClick={(event) => {
            event.stopPropagation();
            remove.mutate(row.original.id);
          }}
          className="cursor-pointer rounded p-1 text-subtle transition-colors hover:bg-danger/10 hover:text-danger"
          aria-label="Delete department"
        >
          <Trash2 className="size-3.5" />
        </button>
      ),
    },
  ];

  return (
    <>
      <DataTable
        data={data}
        columns={columns}
        isLoading={isLoading}
        onRowClick={setEditing}
        empty={
          <EmptyState
            title="No departments yet"
            description="Departments give assets an owner and drive the org chart."
            icon={Building2}
          />
        }
      />

      <Modal
        open={open}
        onClose={close}
        title={editing ? `Edit ${editing.name}` : "Add department"}
        description="A department may sit under a parent, forming the org hierarchy."
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button
              form="department-form"
              type="submit"
              loading={save.isPending}
            >
              {editing ? "Save changes" : "Create"}
            </Button>
          </>
        }
      >
        <form
          id="department-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setErrors({});

            const data = new FormData(event.currentTarget);
            save.mutate({
              name: data.get("name"),
              headUserId: data.get("headUserId") || null,
              parentDepartmentId: data.get("parentDepartmentId") || null,
              status: data.get("status"),
            });
          }}
          className="space-y-3.5"
        >
          <Field label="Name" error={errors.name} required>
            <Input
              name="name"
              defaultValue={editing?.name}
              placeholder="Engineering"
              invalid={Boolean(errors.name)}
              autoFocus
            />
          </Field>

          <Field label="Department head" error={errors.headUserId}>
            <Select name="headUserId" defaultValue={editing?.headUserId ?? ""}>
              <option value="">No head assigned</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name} — {ROLE_LABEL[employee.role]}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Parent department"
            error={errors.parentDepartmentId}
            hint="Leave empty for a top-level department."
          >
            <Select name="parentDepartmentId" defaultValue={editing?.parentDepartmentId ?? ""}>
              <option value="">None (top level)</option>
              {data
                // A department cannot be its own parent — the API enforces the
                // whole cycle rule, but there is no reason to offer the move.
                .filter((department) => department.id !== editing?.id)
                .map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
            </Select>
          </Field>

          <Field label="Status">
            <Select name="status" defaultValue={editing?.status ?? "active"}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </Field>
        </form>
      </Modal>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Categories — including the per-category custom fields
// ─────────────────────────────────────────────────────────────────────────────

function CategoriesTab({ isAdding, onClose }: { isAdding: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Category | null>(null);
  const [fields, setFields] = useState<CustomField[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data = [], isLoading } = useQuery({
    queryKey: ["categories"],
    queryFn: () => get<Category[]>("/categories"),
  });

  const open = isAdding || Boolean(editing);

  const startEdit = (category: Category) => {
    setEditing(category);
    setFields(category.customFields);
  };

  const close = () => {
    setEditing(null);
    setFields([]);
    setErrors({});
    onClose();
  };

  const save = useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      editing ? patch(`/categories/${editing.id}`, input) : post("/categories", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["categories"] });
      toast.success(editing ? "Category updated" : "Category created");
      close();
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        setErrors(error.fieldErrors);
        if (!Object.keys(error.fieldErrors).length) toast.error(error.message);
      }
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => del(`/categories/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["categories"] });
      toast.success("Category deleted");
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Failed"),
  });

  const columns: ColumnDef<Category, unknown>[] = [
    {
      accessorKey: "name",
      header: "Category",
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
    },
    {
      accessorKey: "description",
      header: "Description",
      cell: ({ row }) => (
        <span className="text-muted">{row.original.description ?? "—"}</span>
      ),
    },
    {
      id: "fields",
      header: "Custom fields",
      cell: ({ row }) =>
        row.original.customFields.length ? (
          <div className="flex flex-wrap gap-1">
            {row.original.customFields.map((field) => (
              <span
                key={field.key}
                className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted"
              >
                {field.key}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-subtle">—</span>
        ),
    },
    {
      accessorKey: "assetCount",
      header: "Assets",
      cell: ({ row }) => <span className="nums">{row.original.assetCount}</span>,
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <button
          onClick={(event) => {
            event.stopPropagation();
            remove.mutate(row.original.id);
          }}
          className="cursor-pointer rounded p-1 text-subtle transition-colors hover:bg-danger/10 hover:text-danger"
          aria-label="Delete category"
        >
          <Trash2 className="size-3.5" />
        </button>
      ),
    },
  ];

  return (
    <>
      <DataTable
        data={data}
        columns={columns}
        isLoading={isLoading}
        onRowClick={startEdit}
        empty={
          <EmptyState
            title="No categories yet"
            description="Categories group assets and can define their own extra fields."
            icon={Tags}
          />
        }
      />

      <Modal
        open={open}
        onClose={close}
        title={editing ? `Edit ${editing.name}` : "Add category"}
        description="Categories can declare extra fields — e.g. Electronics wants a warranty period."
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button form="category-form" type="submit" loading={save.isPending}>
              {editing ? "Save changes" : "Create"}
            </Button>
          </>
        }
      >
        <form
          id="category-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setErrors({});

            const data = new FormData(event.currentTarget);
            save.mutate({
              name: data.get("name"),
              description: data.get("description") || null,
              customFields: fields.filter((field) => field.key && field.label),
            });
          }}
          className="space-y-3.5"
        >
          <Field label="Name" error={errors.name} required>
            <Input
              name="name"
              defaultValue={editing?.name}
              placeholder="Electronics"
              invalid={Boolean(errors.name)}
              autoFocus
            />
          </Field>

          <Field label="Description" error={errors.description}>
            <Textarea
              name="description"
              defaultValue={editing?.description ?? ""}
              placeholder="Laptops, monitors, projectors"
              rows={2}
            />
          </Field>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-xs font-medium text-muted">Custom fields</label>
              <button
                type="button"
                onClick={() =>
                  setFields((previous) => [...previous, { key: "", label: "", type: "text" }])
                }
                className="cursor-pointer text-xs font-medium text-primary hover:underline"
              >
                + Add field
              </button>
            </div>

            {!fields.length && (
              <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-subtle">
                No extra fields. Assets in this category will only have the standard ones.
              </p>
            )}

            <div className="space-y-2">
              {fields.map((field, index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    value={field.key}
                    onChange={(event) =>
                      setFields((previous) =>
                        previous.map((f, i) =>
                          i === index ? { ...f, key: event.target.value } : f,
                        ),
                      )
                    }
                    placeholder="warrantyMonths"
                    className="font-mono text-xs"
                  />

                  <Input
                    value={field.label}
                    onChange={(event) =>
                      setFields((previous) =>
                        previous.map((f, i) =>
                          i === index ? { ...f, label: event.target.value } : f,
                        ),
                      )
                    }
                    placeholder="Warranty (months)"
                  />

                  <Select
                    value={field.type}
                    onChange={(event) =>
                      setFields((previous) =>
                        previous.map((f, i) =>
                          i === index
                            ? { ...f, type: event.target.value as CustomField["type"] }
                            : f,
                        ),
                      )
                    }
                    className="w-28"
                  >
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="date">Date</option>
                  </Select>

                  <button
                    type="button"
                    onClick={() => setFields((previous) => previous.filter((_, i) => i !== index))}
                    className="cursor-pointer rounded p-1.5 text-subtle transition-colors hover:text-danger"
                    aria-label="Remove field"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </form>
      </Modal>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Employee Directory — THE ONLY PLACE A ROLE IS EVER ASSIGNED
// ─────────────────────────────────────────────────────────────────────────────

function EmployeesTab() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [search, setSearch] = useState("");

  const { data = [], isLoading } = useQuery({
    queryKey: ["users", search],
    queryFn: () => get<Employee[]>(`/users${search ? `?q=${encodeURIComponent(search)}` : ""}`),
  });

  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Record<string, unknown> }) =>
      patch(`/users/${id}`, input),
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      void queryClient.invalidateQueries({ queryKey: ["departments"] });
      toast.success("Employee updated", {
        description: variables.input.role
          ? `Role changed to ${ROLE_LABEL[variables.input.role as Role]}.`
          : undefined,
      });
    },
    // The API refuses to demote the last Admin, or deactivate someone still
    // holding assets — and says exactly why.
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Failed"),
  });

  const columns: ColumnDef<Employee, unknown>[] = [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <div>
          <p className="font-medium">{row.original.name}</p>
          <p className="text-[11px] text-subtle">{row.original.email}</p>
        </div>
      ),
    },
    {
      accessorKey: "departmentName",
      header: "Department",
      cell: ({ row }) => row.original.departmentName ?? <span className="text-subtle">—</span>,
    },
    {
      id: "role",
      header: "Role",
      cell: ({ row }) => (
        /*
         * THE role picker. This select is the only control in the entire product
         * that can change a role, and it only exists on an Admin-gated screen.
         * Signup cannot express a role at all — the API's signup body has no such
         * field — so this is genuinely the sole path.
         */
        <Select
          value={row.original.role}
          disabled={update.isPending}
          onChange={(event) =>
            update.mutate({ id: row.original.id, input: { role: event.target.value } })
          }
          className="h-8 w-40 text-xs"
        >
          <option value="employee">Employee</option>
          <option value="department_head">Department Head</option>
          <option value="asset_manager">Asset Manager</option>
          <option value="admin">Admin</option>
        </Select>
      ),
    },
    {
      accessorKey: "assetsHeld",
      header: "Assets held",
      cell: ({ row }) => <span className="nums">{row.original.assetsHeld}</span>,
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <button
          onClick={() =>
            update.mutate({
              id: row.original.id,
              input: { status: row.original.status === "active" ? "inactive" : "active" },
            })
          }
          className="cursor-pointer"
          title="Click to toggle"
        >
          <StatusPill status={row.original.status} />
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name or email…"
          className="max-w-sm"
        />
      </div>

      {/* The spec's rule, stated on the screen it governs. */}
      <div className="flex items-start gap-2.5 rounded-card border border-info/25 bg-info-soft px-3.5 py-2.5">
        <ShieldCheck className="mt-px size-4 shrink-0 text-info" />
        <p className="text-xs leading-relaxed text-muted">
          <span className="font-medium text-fg">This is the only place roles are assigned.</span>{" "}
          Signing up always creates an Employee — the signup request has no role field at all. An
          Admin promotes people to Department Head or Asset Manager here.
        </p>
      </div>

      <DataTable
        data={data}
        columns={columns}
        isLoading={isLoading}
        empty={<EmptyState title="No employees found" icon={Users} />}
      />

      {user && (
        <p className="text-xs text-subtle">
          Signed in as {user.name}. The API refuses to remove the last active Admin, or to
          deactivate anyone still holding assets.
        </p>
      )}
    </div>
  );
}
