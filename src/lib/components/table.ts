/** Shared table column descriptor used by <DataTable />. */
export interface Column {
	key: string;
	label: string;
	width?: string;
	align?: 'left' | 'right';
}
