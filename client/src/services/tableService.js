import { doc, updateDoc, collection, addDoc } from 'firebase/firestore';
import { db } from '../firebase';

export function getElapsedSeconds(table) {
  if (table.status === 'running' && table.start_time) {
    const elapsed = Math.floor((Date.now() - new Date(table.start_time).getTime()) / 1000);
    return (table.accumulated_seconds || 0) + elapsed;
  }
  return table.accumulated_seconds || 0;
}

export function computeOpenCost(seconds) {
  const totalMinutes = Math.floor((seconds || 0) / 60);
  const wholeHours = Math.floor(totalMinutes / 60);
  const extraMinutes = totalMinutes % 60;
  if (wholeHours === 0) return 200;
  if (extraMinutes === 0) return wholeHours * 200;
  let totalHours;
  if (wholeHours === 1) {
    totalHours = extraMinutes >= 30 ? 2 : 1.5;
  } else {
    totalHours = wholeHours + (extraMinutes >= 30 ? 1 : 0.5);
  }
  return totalHours * 200;
}

export function computePrepaidCost(setHours) {
  return Math.round(setHours * 200);
}

// Executes an action on a table exactly like the Node.js API did
export async function tableAction(table, action, body = {}, userName = 'Unknown') {
  const tableRef = doc(db, 'tables', table.id.toString());
  const now = new Date().toISOString();

  switch (action) {
    case 'start': {
      const hours = body.hours || 0;
      await updateDoc(tableRef, {
        status: 'running',
        start_time: now,
        accumulated_seconds: 0,
        pause_time: null,
        set_hours: hours,
        cost: hours > 0 ? computePrepaidCost(hours) : 0
      });
      return { start_time: now };
    }
    case 'pause': {
      const elapsed = Math.floor((new Date().getTime() - new Date(table.start_time).getTime()) / 1000);
      const totalAccumulated = (table.accumulated_seconds || 0) + elapsed;
      await updateDoc(tableRef, {
        status: 'paused',
        pause_time: now,
        accumulated_seconds: totalAccumulated,
        start_time: null
      });
      return { accumulated_seconds: totalAccumulated };
    }
    case 'resume': {
      await updateDoc(tableRef, {
        status: 'running',
        start_time: now,
        pause_time: null
      });
      return { start_time: now };
    }
    case 'stop': {
      const totalSeconds = getElapsedSeconds(table);
      const cost = table.set_hours > 0 ? computePrepaidCost(table.set_hours) : computeOpenCost(totalSeconds);
      await updateDoc(tableRef, {
        status: 'finished',
        accumulated_seconds: totalSeconds,
        pause_time: null,
        end_time: now,
        elapsed_seconds: totalSeconds,
        cost
      });
      return { elapsed_seconds: totalSeconds, cost, start_time: table.start_time, end_time: now, table_id: table.id, table_number: table.table_number, set_hours: table.set_hours };
    }
    case 'extend': {
      const hours = body.hours;
      if (!hours || hours <= 0) throw new Error('Hours must be > 0');
      
      let newSetHours, newTotalCost, previousCost, additionalCost, currentSetHours, accumulated;
      
      if (table.status === 'finished') {
        accumulated = table.accumulated_seconds || 0;
        currentSetHours = table.set_hours || (accumulated / 3600);
        newSetHours = currentSetHours + hours;
        const elapsedHoursRounded = Math.ceil(accumulated / 3600);
        previousCost = elapsedHoursRounded * 200;
        additionalCost = hours * 200;
        newTotalCost = previousCost + additionalCost;
        
        await updateDoc(tableRef, {
          status: 'running',
          start_time: now,
          set_hours: newSetHours,
          accumulated_seconds: accumulated,
          cost: newTotalCost
        });
      } else if (table.status === 'running') {
        const elapsed = Math.floor((Date.now() - new Date(table.start_time).getTime()) / 1000);
        accumulated = (table.accumulated_seconds || 0) + elapsed;
        currentSetHours = table.set_hours || 0;
        newSetHours = currentSetHours + hours;
        const elapsedHoursRounded = Math.ceil(accumulated / 3600);
        previousCost = elapsedHoursRounded * 200;
        additionalCost = hours * 200;
        newTotalCost = previousCost + additionalCost;
        
        await updateDoc(tableRef, {
          accumulated_seconds: accumulated,
          start_time: now,
          set_hours: newSetHours,
          cost: newTotalCost
        });
      } else { // paused
        newSetHours = (table.set_hours || 0) + hours;
        await updateDoc(tableRef, { set_hours: newSetHours, cost: computePrepaidCost(newSetHours) });
      }
      
      if (table.status !== 'paused') {
        await addDoc(collection(db, 'extension_history'), {
          table_id: table.id.toString(),
          table_number: table.table_number,
          previous_hours: currentSetHours,
          extended_hours: hours,
          new_total_hours: newSetHours,
          previous_cost: previousCost,
          additional_cost: additionalCost,
          new_total_cost: newTotalCost,
          extended_by: userName,
          extended_at: now
        });
      }
      return { set_hours: newSetHours };
    }
  }
}
