import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import { validateFlow } from '../flowValidation';
import { AUTOMATION_RECIPES } from './recipeData';

describe('automation recipes', () => {
    it.each(AUTOMATION_RECIPES.map((recipe) => [recipe.name, recipe] as const))(
        '%s has no blocking validation issues',
        (_name, recipe) => {
            const nodes = recipe.nodes.map((node, index) => ({
                ...node,
                position: { x: 0, y: index * 100 },
            })) as Node[];
            const edges = recipe.edges.map((edge, index) => ({
                ...edge,
                id: `edge-${index}`,
            })) as Edge[];

            expect(validateFlow(nodes, edges).filter((issue) => issue.severity === 'blocking')).toEqual([]);
        },
    );
});
