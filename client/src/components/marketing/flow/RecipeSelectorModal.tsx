/**
 * RecipeSelectorModal - Pre-built automation recipe templates.
 * Allows users to quickly start with common automation patterns.
 */
import React, { useState } from 'react';
import { X, Search } from 'lucide-react';
import { Modal } from '../../ui/Modal';
import {
    AutomationRecipe,
    AUTOMATION_RECIPES,
    AUTOMATION_CATEGORIES
} from './recipeData';

interface RecipeSelectorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (recipe: AutomationRecipe) => void;
}

/**
 * Recipe card component for displaying individual recipes.
 */
function RecipeCard({
    recipe,
    onSelect
}: {
    recipe: AutomationRecipe;
    onSelect: () => void;
}) {
    return (
        <button
            onClick={onSelect}
            className="flex items-start gap-4 p-4 border rounded-xl hover:border-blue-300 hover:bg-blue-50/50 transition-all text-left group"
        >
            <div className="p-2 bg-gray-100 rounded-lg group-hover:bg-white transition-colors">
                {recipe.icon}
            </div>
            <div className="flex-1 min-w-0">
                <h3 className="font-medium text-gray-900 group-hover:text-blue-700 transition-colors">
                    {recipe.name}
                </h3>
                <p className="text-sm text-gray-500 mt-1 line-clamp-2">
                    {recipe.description}
                </p>
                <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-sm">
                        {recipe.nodes.length} steps
                    </span>
                    <span className="text-xs text-gray-400">
                        {recipe.category}
                    </span>
                </div>
            </div>
        </button>
    );
}

export const RecipeSelectorModal: React.FC<RecipeSelectorModalProps> = ({
    isOpen,
    onClose,
    onSelect,
}) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [activeCategory, setActiveCategory] = useState<string>('All');

    const filteredRecipes = AUTOMATION_RECIPES.filter(recipe => {
        const matchesSearch = recipe.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            recipe.description.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesCategory = activeCategory === 'All' || recipe.category === activeCategory;
        return matchesSearch && matchesCategory;
    });

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={
                <div className="flex items-center justify-between w-full">
                    <div>
                        <div className="font-semibold text-gray-900">Start from a Recipe</div>
                        <p className="text-sm text-gray-500 font-normal">Choose a pre-built automation to get started quickly</p>
                    </div>
                    <div className="relative ml-4">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search recipes..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500 w-48"
                        />
                    </div>
                </div>
            }
            maxWidth="max-w-3xl"
        >
            {/* Category Tabs */}
            <div className="flex gap-2 pb-4 mb-4 border-b bg-gray-50 -mx-5 px-5 -mt-5 pt-5">
                {AUTOMATION_CATEGORIES.map(cat => (
                    <button
                        key={cat}
                        onClick={() => setActiveCategory(cat)}
                        className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${activeCategory === cat
                                ? 'bg-blue-100 text-blue-700'
                                : 'text-gray-600 hover:bg-gray-100'
                            }`}
                    >
                        {cat}
                    </button>
                ))}
            </div>

            {/* Recipe Grid */}
            <div className="grid grid-cols-2 gap-4 max-h-[50vh] overflow-y-auto">
                {filteredRecipes.map(recipe => (
                    <RecipeCard
                        key={recipe.id}
                        recipe={recipe}
                        onSelect={() => {
                            onSelect(recipe);
                            onClose();
                        }}
                    />
                ))}
            </div>

            {filteredRecipes.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                    No recipes found matching "{searchQuery}"
                </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between pt-4 mt-4 border-t">
                <span className="text-sm text-gray-500">{AUTOMATION_RECIPES.length} recipes available</span>
                <button
                    onClick={onClose}
                    className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
                >
                    Start from Scratch
                </button>
            </div>
        </Modal>
    );
};

export type { AutomationRecipe };
