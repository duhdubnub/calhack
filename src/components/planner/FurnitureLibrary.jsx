import React, {useState} from 'react';
import {catalog} from '../../lib/planner/catalog';
export default function FurnitureLibrary({library=catalog,add,room,onLibraryEdit,onLibraryDelete}) {
  const [search,setSearch]=useState('');
  const [deleting,setDeleting]=useState(null),[deleteError,setDeleteError]=useState('');
  return (
      <section className="furniture-library">
        <h2>Library &amp; catalog</h2>
        <label>
          Search furniture
          <input value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <div className="catalog-list">
          {!library.some(c=>c.name.toLowerCase().includes(search.toLowerCase())) && <p>No furniture matches “{search}”. Try a different name.</p>}
          {library
            .filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
            .map((c) => (
              <article
                key={c.id}
                draggable
                onDragStart={(e) =>
                  e.dataTransfer.setData(
                    "application/propertylens-furniture",
                    c.id,
                  )
                }
              >
                <div>
                  <strong>{c.name}</strong>
                  {c.imageUrl && <img className="furniture-thumbnail" src={c.imageUrl} alt={c.name} loading="lazy" referrerPolicy="no-referrer" />}
                  <small>
                    {c.widthIn} × {c.depthIn} × {c.heightIn} in ·{" "}
                    {c.estimated ? "Estimated" : c.source}
                  </small>
                  {c.source === "ikea" && <small>{c.fixture ? "Sample · " : ""}{c.price || "IKEA"} · Sized placeholder</small>}
                </div>
                <button onClick={() => add(c, room)}>Add to room</button>
                {onLibraryEdit && !c.id.startsWith("catalog-") && (
                  <>
                    <button onClick={() => onLibraryEdit(c)}>Edit</button>
                    <button disabled={deleting !== null} onClick={async () => {
                      setDeleting(c.id);setDeleteError("");
                      try {await onLibraryDelete(c.id);}
                      catch(error) {setDeleteError(error.message || "Could not delete this item. Please try again.");}
                      finally {setDeleting(null);}
                    }}>
                      {deleting === c.id ? "Deleting…" : "Delete from library"}
                    </button>
                  </>
                )}
              </article>
            ))}
        </div>
        {deleteError && <p role="alert">{deleteError}</p>}
      </section>
  );
}
