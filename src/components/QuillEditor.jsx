import { useState, useEffect, useRef } from 'react';
import Quill, {Delta} from 'quill';
import 'quill/dist/quill.snow.css';

const QuillEditor = ({ note, onUserInput, isLoading }) => {
  const [title, setTitle] = useState('');
  const [lastNoteId, setLastNoteId] = useState(null);
  const [lastUpdateTime, setLastUpdateTime] = useState(null);
  const [isUserEditing, setIsUserEditing] = useState(false);
  const [isUserEditingTitle, setIsUserEditingTitle] = useState(false);
  const editorRef = useRef(null);
  const quillRef = useRef(null);
  const saveTimeoutRef = useRef(null);
  const titleSaveTimeoutRef = useRef(null);

  // Initialize Quill once
  useEffect(() => {
    console.log("QuillEditor useEffect - note change:", {
      noteId: note?._docID,
      noteTitle: note?.title,
      currentTitle: title
    });

    // Set initial title when creating editor
    if (note?.title && title !== note.title) {
      console.log('Setting initial title:', note.title);
      setTitle(note.title);
    }
    
    if (editorRef.current && !quillRef.current) {
      console.log('Creating Quill editor');
      
      quillRef.current = new Quill(editorRef.current, {
        theme: 'snow',
        placeholder: 'Start writing...',
      });

      console.log("note.content", note.content)
      quillRef.current.clipboard.dangerouslyPasteHTML(note.content)
      
    } else if (quillRef.current) {
      quillRef.current.clipboard.dangerouslyPasteHTML(note.content)
    }

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      if (titleSaveTimeoutRef.current) {
        clearTimeout(titleSaveTimeoutRef.current);
      }
    };
  }, [note?._docID]);

  useEffect(() => {
    if (quillRef.current) {
    // Handle changes with debouncing
    quillRef.current.on('text-change', () => {
      
      setIsUserEditing(true);
      
      // Clear existing timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      
      // Debounced save
      saveTimeoutRef.current = setTimeout(() => {
        if (onUserInput && note?._docID) {
          const content = quillRef.current.root.innerHTML;
          onUserInput(note._docID, { title, content });
          setLastUpdateTime(Date.now());
        }
        setIsUserEditing(false);
      }, 1000);
    });
  }
  }, [quillRef.current])

  // Update when note changes from DefraDB
  useEffect(() => {
    
    if (note && quillRef.current) {
      if (!isUserEditing && !isUserEditingTitle && note.updatedAt) {
        const noteUpdateTime = new Date(note.updatedAt).getTime();
        console.log("noteUpdateTime", noteUpdateTime, "lastUpdateTime", lastUpdateTime)
        if (noteUpdateTime > lastUpdateTime) {
          console.log('Note updated from DefraDB:', note);
          console.log('Setting title to:', note.title || '');
          
          // Only update title if user is not actively editing it
          if (!isUserEditingTitle) {
            setTitle(note.title);
          }
          quillRef.current.clipboard.dangerouslyPasteHTML(note.content);
          setLastUpdateTime(noteUpdateTime);
        }
      }
    }
  }, [note, isUserEditing, isUserEditingTitle, lastNoteId, lastUpdateTime]);

  const handleTitleChange = (e) => {
    const newTitle = e.target.value;
    console.log('handleTitleChange called:', {
      newTitle,
      currentTitle: title,
      noteId: note?._docID
    });
    setTitle(newTitle);
    setIsUserEditingTitle(true);
    
    // Clear existing timeout
    if (titleSaveTimeoutRef.current) {
      clearTimeout(titleSaveTimeoutRef.current);
    }
    
    // Debounced save for title changes
    titleSaveTimeoutRef.current = setTimeout(() => {
      console.log('Saving title change:', newTitle);
      if (onUserInput && note?._docID) {
        const content = quillRef.current?.getText() || '';
        onUserInput(note._docID, { title: newTitle, content });
        setLastUpdateTime(Date.now());
      }
      setIsUserEditingTitle(false);
    }, 1000);
  };

  if (isLoading && !note) {
    return <div className="p-4">Loading...</div>;
  }

  if (!note) {
    return <div className="p-4">No note selected</div>;
  }

  return (
    <div className="flex-1 flex flex-col">
      <div className="p-4 border-b">
        <input
          type="text"
          value={title}
          onChange={handleTitleChange}
          className="text-2xl font-bold w-full border-none outline-none"
          placeholder="Note title"
        />
      </div>
      <div className="flex-1 p-4">
        <div ref={editorRef} style={{ height: '400px' }} />
      </div>
    </div>
  );
};

export default QuillEditor;
