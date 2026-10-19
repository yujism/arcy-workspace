'use client';

import {useMemo,useState} from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {SortableContext,sortableKeyboardCoordinates,useSortable,verticalListSortingStrategy} from '@dnd-kit/sortable';
import {CSS} from '@dnd-kit/utilities';
import {Check,Clock,GripVertical,LoaderCircle,Plus} from 'lucide-react';
import type {RecordItem} from '@/lib/data';

export type TaskStatus='open'|'in_progress'|'done';

const columns=[
  {status:'open' as const,label:'To do',icon:Clock},
  {status:'in_progress' as const,label:'In progress',icon:LoaderCircle},
  {status:'done' as const,label:'Done',icon:Check},
];

const statusOf=(task:RecordItem):TaskStatus=>task.meta.status==='done'?'done':task.meta.status==='in_progress'?'in_progress':'open';

function dueLabel(value?:string){
  if(!value)return 'No deadline';
  return new Date(value+'T12:00:00+07:00').toLocaleDateString('en-GB',{timeZone:'Asia/Jakarta',day:'numeric',month:'short'});
}

function KanbanCard({task,onEdit,overlay=false,disabled=false}:{task:RecordItem;onEdit:(task:RecordItem)=>void;overlay?:boolean;disabled?:boolean}){
  const {attributes,listeners,setNodeRef,transform,transition,isDragging}=useSortable({id:task.id,disabled});
  const overdue=task.meta.due&&task.meta.due<new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta'}).format(new Date())&&statusOf(task)!=='done';
  return <article
    ref={setNodeRef}
    className={'kanban-card '+(isDragging?'dragging ':'')+(overlay?'overlay ':'')+(disabled?'saving':'')}
    style={{transform:CSS.Translate.toString(transform),transition}}
  >
    <button className="kanban-card-main" onClick={()=>onEdit(task)}>
      <strong>{task.title}</strong>
      {task.body&&<span>{task.body.slice(0,82)}</span>}
    </button>
    <footer>
      <span className={'kanban-due '+(overdue?'overdue':'')}>{dueLabel(task.meta.due)}</span>
      <span className={'priority '+(task.meta.priority||'medium')}>{task.meta.priority||'medium'}</span>
      {!overlay&&<button className="drag-handle" aria-label={'Move '+task.title} {...attributes} {...listeners}><GripVertical size={16}/></button>}
    </footer>
  </article>;
}

function KanbanColumn({status,label,icon:Icon,tasks,onEdit,movingTask}:{status:TaskStatus;label:string;icon:typeof Clock;tasks:RecordItem[];onEdit:(task:RecordItem)=>void;movingTask:string}){
  const {setNodeRef,isOver}=useDroppable({id:'column:'+status});
  return <section ref={setNodeRef} className={'kanban-column '+(isOver?'over':'')} aria-label={label}>
    <header><span className={'kanban-column-icon '+status}><Icon size={15}/></span><h3>{label}</h3><span className="kanban-count">{tasks.length}</span></header>
    <SortableContext items={tasks.map(task=>task.id)} strategy={verticalListSortingStrategy}>
      <div className="kanban-column-body">
        {tasks.map(task=><KanbanCard key={task.id} task={task} onEdit={onEdit} disabled={movingTask===task.id}/>)}
        {!tasks.length&&<div className="kanban-empty">Drop a task here</div>}
      </div>
    </SortableContext>
  </section>;
}

export default function HomeKanban({tasks,loading,movingTask,onMove,onEdit,onAdd,onAll}:{tasks:RecordItem[];loading:boolean;movingTask:string;onMove:(task:RecordItem,status:TaskStatus)=>Promise<void>;onEdit:(task:RecordItem)=>void;onAdd:()=>void;onAll:()=>void}){
  const [activeId,setActiveId]=useState<string|null>(null);
  const sensors=useSensors(
    useSensor(PointerSensor,{activationConstraint:{distance:7}}),
    useSensor(TouchSensor,{activationConstraint:{delay:140,tolerance:8}}),
    useSensor(KeyboardSensor,{coordinateGetter:sortableKeyboardCoordinates}),
  );
  const grouped=useMemo(()=>Object.fromEntries(columns.map(column=>[column.status,tasks.filter(task=>statusOf(task)===column.status)])) as Record<TaskStatus,RecordItem[]>,[tasks]);
  const activeTask=activeId?tasks.find(task=>task.id===activeId):undefined;

  function dragStart(event:DragStartEvent){setActiveId(String(event.active.id));}
  function dragEnd(event:DragEndEvent){
    setActiveId(null);
    if(!event.over)return;
    const task=tasks.find(item=>item.id===String(event.active.id));
    if(!task)return;
    const overId=String(event.over.id);
    const overTask=tasks.find(item=>item.id===overId);
    const target=overId.startsWith('column:')?overId.slice(7) as TaskStatus:overTask?statusOf(overTask):statusOf(task);
    if(target!==statusOf(task))void onMove(task,target);
  }

  return <section className="kanban-panel" aria-labelledby="kanban-title">
    <div className="section-heading kanban-heading"><div><h2 id="kanban-title">Task board <span className="count">{tasks.length}</span></h2><p>Drag work forward as it moves.</p></div><button className="text-button" onClick={onAll}>All tasks</button></div>
    {loading?<div className="kanban-loading" aria-label="Loading task board">{columns.map(column=><div key={column.status}><span/><span/></div>)}</div>:
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={dragStart} onDragCancel={()=>setActiveId(null)} onDragEnd={dragEnd}>
      <div className="kanban-board">
        {columns.map(column=><KanbanColumn key={column.status} {...column} tasks={grouped[column.status]} onEdit={onEdit} movingTask={movingTask}/>) }
      </div>
      <DragOverlay dropAnimation={{duration:180,easing:'cubic-bezier(.16,1,.3,1)'}}>{activeTask?<KanbanCard task={activeTask} onEdit={onEdit} overlay/>:null}</DragOverlay>
    </DndContext>}
    <button className="kanban-add" onClick={onAdd}><Plus size={16}/>Add a task</button>
  </section>;
}
