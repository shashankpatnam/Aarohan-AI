import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const DEFAULT_WIDTH = 160;

function computePosition(anchorEl, menuEl, menuWidth) {
  const anchor = anchorEl.getBoundingClientRect();
  const menuHeight = menuEl?.offsetHeight ?? 140;
  const margin = 4;
  const spaceBelow = window.innerHeight - anchor.bottom;
  const openUpward =
    spaceBelow < menuHeight + margin && anchor.top > menuHeight + margin;

  const top = openUpward
    ? anchor.top - menuHeight - margin
    : anchor.bottom + margin;

  const left = Math.min(
    Math.max(8, anchor.right - menuWidth),
    window.innerWidth - menuWidth - 8,
  );

  return { top, left };
}

function FloatingMenu({
  open,
  onClose,
  anchorRef,
  children,
  menuWidth = DEFAULT_WIDTH,
  className = "",
}) {
  const menuRef = useRef(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    if (!open || !anchorRef?.current) {
      setReady(false);
      return;
    }

    const update = () => {
      if (!anchorRef.current || !menuRef.current) return;
      setPosition(computePosition(anchorRef.current, menuRef.current, menuWidth));
      setReady(true);
    };

    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [open, anchorRef, menuWidth, children]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    function onScroll() {
      onClose();
    }

    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return createPortal(
    <>
      <button
        type="button"
        aria-label="Close menu"
        className="fixed inset-0 z-[100] cursor-default bg-transparent"
        onClick={onClose}
      />
      <div
        ref={menuRef}
        role="menu"
        style={{
          top: position.top,
          left: position.left,
          width: menuWidth,
          visibility: ready ? "visible" : "hidden",
        }}
        className={`fixed z-[101] rounded-lg border border-gray-200 bg-white py-1 shadow-lg ${className}`}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}

export default FloatingMenu;
