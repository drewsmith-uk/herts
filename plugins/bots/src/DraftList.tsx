import {useState} from 'react';
import {Button,ItemList,ItemRow,ItemMeta} from '@herts/plugin-api/client';
export function DraftList({drafts,open}:{drafts:{id:string;fields:any}[];open(row:{id:string;fields:any}):void}){
 const [all,setAll]=useState(false);
 if(!drafts.length)return null;
 return <section className="conversation-drafts"><h2>Saved drafts <span className="heading-count">{drafts.length}</span></h2><ItemList>{(all?drafts:drafts.slice(0,3)).map(row=><ItemRow key={row.id}><Button variant="quiet" className="draft-open" onClick={()=>open(row)}><h3 className="item-title">{row.fields.title||row.fields.name||'Untitled draft'}</h3><ItemMeta>Saved on this device</ItemMeta></Button></ItemRow>)}</ItemList>{drafts.length>3&&<Button variant="quiet" aria-expanded={all} onClick={()=>setAll(v=>!v)}>{all?'Show fewer drafts':`Show all ${drafts.length} drafts`}</Button>}</section>;
}
