/**
 * Sortable Item Wrapper for drag-and-drop functionality
 * Uses @dnd-kit for accessible, performant drag-and-drop
 */

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Box } from '@mui/material';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import { ReactNode } from 'react';

interface SortableItemProps {
  id: string | number;
  children: ReactNode;
  disabled?: boolean;
}

export default function SortableItem({ id, children, disabled = false }: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1000 : 'auto',
  };

  return (
    <Box
      ref={setNodeRef}
      style={style}
      sx={{
        position: 'relative',
        '&:hover .drag-handle': {
          opacity: disabled ? 0 : 1,
        },
      }}
    >
      {/* Drag Handle */}
      {!disabled && (
        <Box
          className="drag-handle"
          {...attributes}
          {...listeners}
          sx={{
            position: 'absolute',
            top: 8,
            left: 8,
            zIndex: 10,
            cursor: isDragging ? 'grabbing' : 'grab',
            opacity: 0,
            transition: 'opacity 0.2s ease',
            bgcolor: 'rgba(0,0,0,0.6)',
            borderRadius: 1,
            p: 0.5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backdropFilter: 'blur(4px)',
            '&:hover': {
              bgcolor: 'rgba(0,0,0,0.8)',
            },
            '&:focus': {
              opacity: 1,
              outline: '2px solid',
              outlineColor: 'primary.main',
            },
          }}
        >
          <DragIndicatorIcon sx={{ fontSize: 20, color: 'white' }} />
        </Box>
      )}
      {children}
    </Box>
  );
}
