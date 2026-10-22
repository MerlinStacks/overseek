import { useState } from 'react';
import { Modal } from '../../ui/Modal';
import { AutomationRecipe, AUTOMATION_RECIPES, AUTOMATION_CATEGORIES } from './recipeData';
import { useAuth } from '../../../context/AuthContext';
import { useAccount } from '../../../context/AccountContext';
import { usePermissions } from '../../../hooks/usePermissions';
import { useScopedMutation } from '../../../hooks/useScopedMutation';
interface Props { isOpen: boolean; onClose: () => void; onSelect: (recipe: AutomationRecipe) => void | boolean | Promise<void | boolean>; workspaceId?: string }
export function RecipeSelectorModal(props: Props) {
    const { token, user } = useAuth(), { currentAccount } = useAccount();
    return props.isOpen ? <RecipeScope key={JSON.stringify([user?.id, token, currentAccount?.id, props.workspaceId])} {...props} /> : null;
}
function RecipeScope({ onClose, onSelect }: Props) {
    const { token } = useAuth(), { currentAccount } = useAccount(), { hasPermission } = usePermissions();
    const [query, setQuery] = useState(''), [category, setCategory] = useState('All');
    const mutation = useScopedMutation(), allowed = !!token && !!currentAccount && hasPermission('manage_marketing');
    const select = async (recipe: AutomationRecipe) => {
        if (!allowed || mutation.isPending() || !window.confirm('Replace the current local graph with this recipe? Unsaved graph edits will be replaced. This imports a draft only; it does not save, activate or send emails.')) return;
        const result = await mutation.run(async () => {
            if (recipe.nodes.length > 100 || recipe.edges.length > 200 || new Set(recipe.nodes.map(node => node.id)).size !== recipe.nodes.length || recipe.edges.some(edge => !recipe.nodes.some(node => node.id === edge.source) || !recipe.nodes.some(node => node.id === edge.target))) throw new Error('Invalid recipe graph');
            const accepted = await onSelect({ ...recipe, nodes: structuredClone(recipe.nodes), edges: structuredClone(recipe.edges) });
            if (accepted === false) throw new Error('Draft replacement declined');
        }, 'Recipe import was not acknowledged. Your current graph may need review; this selector did not save or activate it.');
        if (result.ok && mutation.isActive()) onClose();
    };
    const recipes = AUTOMATION_RECIPES.filter(recipe => (category === 'All' || recipe.category === category) && `${recipe.name} ${recipe.description}`.toLowerCase().includes(query.trim().toLowerCase()));
    return <Modal isOpen onClose={mutation.busy ? undefined : onClose} title="Import a recipe draft" maxWidth="max-w-3xl"><div className="space-y-4 text-slate-900 dark:text-slate-100"><p>Import replaces this local graph only. Recipe step counts do not establish content, consent or activation readiness.</p>{!allowed && <p role="alert">Select an account with marketing management access.</p>}{mutation.error && <p role="alert">{mutation.error}</p>}<label className="block">Search recipes<input className="block w-full rounded border dark:bg-slate-800" value={query} maxLength={200} onChange={event => setQuery(event.target.value)} /></label><div className="flex flex-wrap gap-2">{AUTOMATION_CATEGORIES.map(value => <button type="button" aria-pressed={category === value} key={value} onClick={() => setCategory(value)}>{value}</button>)}</div><div className="grid gap-3 sm:grid-cols-2">{recipes.map(recipe => <button type="button" className="rounded-xl border p-4 text-left hover:bg-slate-50 dark:hover:bg-slate-800" key={recipe.id} disabled={!allowed || mutation.busy} onClick={() => void select(recipe)}><span className="font-semibold">{recipe.name}</span><p>{recipe.description}</p><p className="text-sm">{recipe.nodes.length} graph nodes · {recipe.category}</p></button>)}</div>{!recipes.length && <p>No recipes match this filter.</p>}<button type="button" disabled={mutation.busy} onClick={onClose}>Keep current graph / close</button></div></Modal>;
}
export type { AutomationRecipe };
